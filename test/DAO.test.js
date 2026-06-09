const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  mineUpTo,
} = require("@nomicfoundation/hardhat-network-helpers");

// Helper: 18-decimal token amount as a BigInt.
const e18 = (n) => ethers.parseEther(String(n));

// Support enum used by castVote: 0 = Against, 1 = For, 2 = Abstain.
const AGAINST = 0;
const FOR = 1;
const ABSTAIN = 2;

// ProposalState enum mirrors the contract ordering.
const State = {
  Pending: 0,
  Active: 1,
  Canceled: 2,
  Defeated: 3,
  Succeeded: 4,
  Queued: 5,
  Executed: 6,
};

describe("DAO Governance", function () {
  // ----------------------------------------------------------------
  //  Fixtures & helpers
  // ----------------------------------------------------------------

  async function deployFixture() {
    const [owner, alice, bob, carol, treasury] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const DAO = await ethers.getContractFactory("DAO");
    const dao = await DAO.deploy(await token.getAddress());
    await dao.waitForDeployment();

    return { token, dao, owner, alice, bob, carol, treasury };
  }

  // Mint `amount` to `account` and self-delegate so the tokens carry voting
  // power. Self-delegation is required for ERC20Votes-style checkpoints.
  async function fundVoter(token, owner, account, amount) {
    await token.connect(owner).mint(account.address, amount);
    await token.connect(account).delegate(account.address);
  }

  // Create a proposal and advance the chain until it is Active.
  async function createActiveProposal(dao, proposer, description = "Fund the dev grant") {
    const tx = await dao.connect(proposer).propose(description);
    await tx.wait();
    const id = (await dao.getProposalCount()) - 1n;
    const p = await dao.getProposal(id);
    await mineUpTo(Number(p.startBlock) + 1); // block.number > startBlock => Active
    return id;
  }

  // ----------------------------------------------------------------
  //  GovernanceToken
  // ----------------------------------------------------------------

  describe("GovernanceToken", function () {
    it("sets the deployer as owner and exposes ERC-20 metadata", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.name()).to.equal("GovernanceToken");
      expect(await token.symbol()).to.equal("GOV");
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("lets the owner mint, updating balance & totalSupply and emitting Transfer", async function () {
      const { token, owner, alice } = await loadFixture(deployFixture);
      await expect(token.connect(owner).mint(alice.address, e18(100)))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, e18(100));
      expect(await token.balanceOf(alice.address)).to.equal(e18(100));
      expect(await token.totalSupply()).to.equal(e18(100));
    });

    it("reverts when a non-owner attempts to mint", async function () {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await expect(
        token.connect(alice).mint(bob.address, e18(1))
      ).to.be.revertedWith("Not owner");
    });

    it("reverts when minting to the zero address", async function () {
      const { token, owner } = await loadFixture(deployFixture);
      await expect(
        token.connect(owner).mint(ethers.ZeroAddress, e18(1))
      ).to.be.revertedWith("Zero address");
    });

    it("assigns voting power only after delegation (getVotes)", async function () {
      const { token, owner, alice } = await loadFixture(deployFixture);
      await token.connect(owner).mint(alice.address, e18(50));
      // Holding tokens without delegating gives zero voting power.
      expect(await token.getVotes(alice.address)).to.equal(0n);
      await expect(token.connect(alice).delegate(alice.address))
        .to.emit(token, "DelegateChanged")
        .withArgs(alice.address, ethers.ZeroAddress, alice.address);
      expect(await token.getVotes(alice.address)).to.equal(e18(50));
    });

    it("moves voting power between delegates on transfer", async function () {
      const { token, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await token.connect(bob).delegate(bob.address); // bob delegates (0 balance for now)
      await token.connect(alice).transfer(bob.address, e18(40));
      expect(await token.getVotes(alice.address)).to.equal(e18(60));
      expect(await token.getVotes(bob.address)).to.equal(e18(40));
    });

    it("records historical voting power via getPastVotes checkpoints", async function () {
      const { token, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const delegateBlock = await ethers.provider.getBlockNumber();
      await mine(2);
      // After the delegation block, the snapshot reflects the full balance.
      expect(await token.getPastVotes(alice.address, delegateBlock)).to.equal(e18(100));
      // One block before delegation existed, the account had no voting power.
      expect(await token.getPastVotes(alice.address, delegateBlock - 1)).to.equal(0n);
    });

    it("reverts getPastVotes for a block that is not yet finalised", async function () {
      const { token, alice } = await loadFixture(deployFixture);
      const current = await ethers.provider.getBlockNumber();
      await expect(
        token.getPastVotes(alice.address, current)
      ).to.be.revertedWith("Not yet determined");
    });

    it("tracks historical total supply via getPastTotalSupply", async function () {
      const { token, owner, alice, bob } = await loadFixture(deployFixture);
      await token.connect(owner).mint(alice.address, e18(100));
      await token.connect(owner).mint(bob.address, e18(50));
      const snap = await ethers.provider.getBlockNumber();
      await mine(1);
      expect(await token.getPastTotalSupply(snap)).to.equal(e18(150));
    });
  });

  // ----------------------------------------------------------------
  //  DAO.propose
  // ----------------------------------------------------------------

  describe("propose", function () {
    it("reverts when the proposer has no voting power", async function () {
      const { dao, alice } = await loadFixture(deployFixture);
      await expect(
        dao.connect(alice).propose("Nice idea")
      ).to.be.revertedWith("DAO: proposer lacks voting power");
    });

    it("lets a voter propose and emits ProposalCreated with the right args", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));

      const tx = await dao.connect(alice).propose("Fund the dev grant");
      const rcpt = await tx.wait();
      const start = BigInt(rcpt.blockNumber) + 1n;
      const end = start + 50400n;

      await expect(tx)
        .to.emit(dao, "ProposalCreated")
        .withArgs(0n, alice.address, "Fund the dev grant", start, end);
      expect(await dao.getProposalCount()).to.equal(1n);
    });

    it("stores the proposal with correct initial fields", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const tx = await dao.connect(alice).propose("Fund the dev grant");
      const rcpt = await tx.wait();

      const p = await dao.getProposal(0);
      expect(p.id).to.equal(0n);
      expect(p.proposer).to.equal(alice.address);
      expect(p.description).to.equal("Fund the dev grant");
      expect(p.forVotes).to.equal(0n);
      expect(p.againstVotes).to.equal(0n);
      expect(p.abstainVotes).to.equal(0n);
      expect(p.startBlock).to.equal(BigInt(rcpt.blockNumber) + 1n);
      expect(p.endBlock).to.equal(p.startBlock + 50400n);
      expect(p.executed).to.equal(false);
      expect(p.canceled).to.equal(false);
    });

    it("starts a freshly created proposal in the Pending state", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await dao.connect(alice).propose("Fund the dev grant");
      expect(await dao.getProposalState(0)).to.equal(State.Pending);
    });

    it("reverts getProposalState for an unknown proposal", async function () {
      const { dao } = await loadFixture(deployFixture);
      await expect(dao.getProposalState(42)).to.be.revertedWith("DAO: unknown proposal");
    });
  });

  // ----------------------------------------------------------------
  //  DAO.castVote
  // ----------------------------------------------------------------

  describe("castVote", function () {
    it("reverts when voting on a Pending proposal", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await dao.connect(alice).propose("Fund the dev grant"); // still Pending
      await expect(
        dao.connect(alice).castVote(0, FOR)
      ).to.be.revertedWith("DAO: proposal not active");
    });

    it("tallies a For vote and emits VoteCast", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);

      await expect(dao.connect(alice).castVote(id, FOR))
        .to.emit(dao, "VoteCast")
        .withArgs(alice.address, id, FOR, e18(100), "");

      const p = await dao.getProposal(id);
      expect(p.forVotes).to.equal(e18(100));
      expect(p.againstVotes).to.equal(0n);
      expect(p.abstainVotes).to.equal(0n);
      expect(await dao.hasVoted(id, alice.address)).to.equal(true);
      expect(await dao.voteChoice(id, alice.address)).to.equal(FOR);
    });

    it("tallies an Against vote", async function () {
      const { token, dao, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await fundVoter(token, owner, bob, e18(30));
      const id = await createActiveProposal(dao, alice);

      await dao.connect(bob).castVote(id, AGAINST);
      const p = await dao.getProposal(id);
      expect(p.againstVotes).to.equal(e18(30));
      expect(p.forVotes).to.equal(0n);
    });

    it("tallies an Abstain vote", async function () {
      const { token, dao, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await fundVoter(token, owner, bob, e18(20));
      const id = await createActiveProposal(dao, alice);

      await dao.connect(bob).castVote(id, ABSTAIN);
      const p = await dao.getProposal(id);
      expect(p.abstainVotes).to.equal(e18(20));
    });

    it("accepts a vote with a reason string", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      await expect(dao.connect(alice).castVoteWithReason(id, FOR, "LGTM"))
        .to.emit(dao, "VoteCast")
        .withArgs(alice.address, id, FOR, e18(100), "LGTM");
    });

    it("reverts on a double vote", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).castVote(id, FOR);
      await expect(
        dao.connect(alice).castVote(id, AGAINST)
      ).to.be.revertedWith("DAO: already voted");
    });

    it("reverts on an invalid support value", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      await expect(
        dao.connect(alice).castVote(id, 3)
      ).to.be.revertedWith("DAO: invalid support value");
    });

    it("reverts when the voter had no voting power at the snapshot", async function () {
      const { token, dao, owner, alice, carol } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      // carol never received tokens / delegated => zero snapshot weight.
      await expect(
        dao.connect(carol).castVote(id, FOR)
      ).to.be.revertedWith("DAO: no voting power at snapshot");
    });

    it("reverts when voting after the voting period has ended", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      await expect(
        dao.connect(alice).castVote(id, FOR)
      ).to.be.revertedWith("DAO: proposal not active");
    });
  });

  // ----------------------------------------------------------------
  //  State machine & quorum
  // ----------------------------------------------------------------

  describe("proposal state machine & quorum", function () {
    it("transitions Pending -> Active once the voting delay elapses", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await dao.connect(alice).propose("Fund the dev grant");
      expect(await dao.getProposalState(0)).to.equal(State.Pending);
      const p = await dao.getProposal(0);
      await mineUpTo(Number(p.startBlock) + 1);
      expect(await dao.getProposalState(0)).to.equal(State.Active);
    });

    it("ends as Succeeded when quorum is met and For > Against", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100)); // supply 100, quorum = 4
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).castVote(id, FOR); // 100 For, well above quorum
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      expect(await dao.getProposalState(id)).to.equal(State.Succeeded);
    });

    it("ends as Defeated when For does not exceed Against (tie)", async function () {
      const { token, dao, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await fundVoter(token, owner, bob, e18(100)); // supply 200, quorum = 8
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).castVote(id, FOR); // 100 For
      await dao.connect(bob).castVote(id, AGAINST); // 100 Against -> tie
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      expect(await dao.getProposalState(id)).to.equal(State.Defeated);
    });

    it("ends as Defeated when quorum is not reached, even with more For than Against", async function () {
      const { token, dao, owner, alice, treasury } = await loadFixture(deployFixture);
      // Inflate supply with undelegated treasury tokens so quorum is high.
      await token.connect(owner).mint(treasury.address, e18(1000)); // supply +1000, 0 votes
      await fundVoter(token, owner, alice, e18(10)); // supply 1010, quorum = 40.4
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).castVote(id, FOR); // only 10 For < 40.4 quorum
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      expect(await dao.getProposalState(id)).to.equal(State.Defeated);
    });

    it("exposes the quorum requirement via quorumVotes()", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await token.connect(owner).mint(alice.address, e18(1000));
      const snap = await ethers.provider.getBlockNumber();
      await mine(1);
      // 4% of 1000 = 40
      expect(await dao.quorumVotes(snap)).to.equal(e18(40));
    });
  });

  // ----------------------------------------------------------------
  //  execute
  // ----------------------------------------------------------------

  describe("execute", function () {
    it("executes a Succeeded proposal and emits ProposalExecuted", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).castVote(id, FOR);
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);

      await expect(dao.connect(alice).execute(id))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(id);
      expect(await dao.getProposalState(id)).to.equal(State.Executed);
    });

    it("reverts when executing a proposal that did not succeed", async function () {
      const { token, dao, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await fundVoter(token, owner, bob, e18(100));
      const id = await createActiveProposal(dao, alice);
      await dao.connect(bob).castVote(id, AGAINST); // Against wins -> Defeated
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      expect(await dao.getProposalState(id)).to.equal(State.Defeated);
      await expect(dao.execute(id)).to.be.revertedWith("DAO: proposal not succeeded");
    });

    it("cannot execute the same proposal twice", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).castVote(id, FOR);
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      await dao.connect(alice).execute(id);
      await expect(dao.execute(id)).to.be.revertedWith("DAO: proposal not succeeded");
    });
  });

  // ----------------------------------------------------------------
  //  cancel
  // ----------------------------------------------------------------

  describe("cancel", function () {
    it("lets the proposer cancel a Pending proposal", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await dao.connect(alice).propose("Fund the dev grant");
      await expect(dao.connect(alice).cancel(0))
        .to.emit(dao, "ProposalCanceled")
        .withArgs(0n);
      expect(await dao.getProposalState(0)).to.equal(State.Canceled);
    });

    it("lets the proposer cancel an Active proposal", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).cancel(id);
      expect(await dao.getProposalState(id)).to.equal(State.Canceled);
    });

    it("reverts when a non-proposer tries to cancel", async function () {
      const { token, dao, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await dao.connect(alice).propose("Fund the dev grant");
      await expect(dao.connect(bob).cancel(0)).to.be.revertedWith("DAO: not proposer");
    });

    it("reverts when cancelling after the voting period has ended", async function () {
      const { token, dao, owner, alice } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      const id = await createActiveProposal(dao, alice);
      const p = await dao.getProposal(id);
      await mineUpTo(Number(p.endBlock) + 1);
      await expect(dao.connect(alice).cancel(id)).to.be.revertedWith("DAO: cannot cancel");
    });

    it("blocks voting on a canceled proposal", async function () {
      const { token, dao, owner, alice, bob } = await loadFixture(deployFixture);
      await fundVoter(token, owner, alice, e18(100));
      await fundVoter(token, owner, bob, e18(50));
      const id = await createActiveProposal(dao, alice);
      await dao.connect(alice).cancel(id);
      await expect(
        dao.connect(bob).castVote(id, FOR)
      ).to.be.revertedWith("DAO: proposal not active");
    });
  });
});
