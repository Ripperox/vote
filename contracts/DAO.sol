// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =============================================================
//  GovernanceToken — ERC20 with delegation + historical votes
// =============================================================

/**
 * @title GovernanceToken
 * @notice ERC-20 token that tracks voting power via EIP-5805 delegation
 *         and supports historical vote snapshots (getPastVotes).
 *         Inherits ERC20Votes from OpenZeppelin in a real deployment.
 */
contract GovernanceToken {
    // ---- ERC-20 Storage ----
    string public name     = "GovernanceToken";
    string public symbol   = "GOV";
    uint8  public decimals = 18;
    uint256 public totalSupply;

    address public owner;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ---- Delegation / Vote Checkpoints ----
    struct Checkpoint {
        uint32  fromBlock;
        uint224 votes;
    }

    mapping(address => address)                  private _delegates;
    mapping(address => Checkpoint[])             private _checkpoints;
    Checkpoint[]                                 private _totalSupplyCheckpoints;

    // ---- Events ----
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateVotesChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ---- ERC-20 Core ----

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address owner_, address spender) public view returns (uint256) {
        return _allowances[owner_][spender];
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        uint256 allowed = _allowances[from][msg.sender];
        require(allowed >= amount, "Insufficient allowance");
        unchecked { _allowances[from][msg.sender] = allowed - amount; }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "Zero address");
        uint256 fromBalance = _balances[from];
        require(fromBalance >= amount, "Insufficient balance");
        unchecked { _balances[from] = fromBalance - amount; }
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        _moveDelegateVotes(delegates(from), delegates(to), amount);
    }

    // ---- Minting (owner only) ----

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
        _writeCheckpoint(_totalSupplyCheckpoints, _add, amount);
        _moveDelegateVotes(address(0), delegates(to), amount);
    }

    // ---- Delegation ----

    function delegates(address account) public view returns (address) {
        return _delegates[account];
    }

    function delegate(address delegatee) external {
        address currentDelegate = delegates(msg.sender);
        uint256 delegatorBalance = balanceOf(msg.sender);
        _delegates[msg.sender] = delegatee;
        emit DelegateChanged(msg.sender, currentDelegate, delegatee);
        _moveDelegateVotes(currentDelegate, delegatee, delegatorBalance);
    }

    // ---- Vote Queries ----

    function getVotes(address account) public view returns (uint256) {
        uint256 pos = _checkpoints[account].length;
        return pos == 0 ? 0 : _checkpoints[account][pos - 1].votes;
    }

    function getPastVotes(address account, uint256 blockNumber) public view returns (uint256) {
        require(blockNumber < block.number, "Not yet determined");
        return _checkpointsLookup(_checkpoints[account], blockNumber);
    }

    function getPastTotalSupply(uint256 blockNumber) public view returns (uint256) {
        require(blockNumber < block.number, "Not yet determined");
        return _checkpointsLookup(_totalSupplyCheckpoints, blockNumber);
    }

    // ---- Internal Checkpoint Helpers ----

    function _moveDelegateVotes(address src, address dst, uint256 amount) private {
        if (src != dst && amount > 0) {
            if (src != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(_checkpoints[src], _subtract, amount);
                emit DelegateVotesChanged(src, oldWeight, newWeight);
            }
            if (dst != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(_checkpoints[dst], _add, amount);
                emit DelegateVotesChanged(dst, oldWeight, newWeight);
            }
        }
    }

    function _writeCheckpoint(
        Checkpoint[] storage ckpts,
        function(uint256, uint256) pure returns (uint256) op,
        uint256 delta
    ) private returns (uint256 oldWeight, uint256 newWeight) {
        uint256 pos = ckpts.length;
        oldWeight = pos == 0 ? 0 : ckpts[pos - 1].votes;
        newWeight = op(oldWeight, delta);
        if (pos > 0 && ckpts[pos - 1].fromBlock == block.number) {
            ckpts[pos - 1].votes = uint224(newWeight);
        } else {
            ckpts.push(Checkpoint({
                fromBlock: uint32(block.number),
                votes:     uint224(newWeight)
            }));
        }
    }

    function _checkpointsLookup(Checkpoint[] storage ckpts, uint256 blockNumber)
        private view returns (uint256)
    {
        uint256 high = ckpts.length;
        uint256 low  = 0;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (ckpts[mid].fromBlock > blockNumber) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return high == 0 ? 0 : ckpts[high - 1].votes;
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) { return a + b; }
    function _subtract(uint256 a, uint256 b) private pure returns (uint256) { return a - b; }
}

// =============================================================
//  DAO Governor
// =============================================================

/**
 * @title DAO
 * @notice On-chain governance contract. Token holders delegate voting
 *         power and use it to create and vote on proposals.
 *
 *  Voting period : 50 400 blocks  (~1 week at 12 s/block)
 *  Voting delay  : 1 block        (snapshot taken 1 block after proposal)
 *  Quorum        : 4% of token total supply at snapshot block
 *  Support values: 0 = Against  |  1 = For  |  2 = Abstain
 */
contract DAO {
    // ---- Types ----

    enum ProposalState {
        Pending,    // 0 — created, delay not elapsed
        Active,     // 1 — voting window open
        Canceled,   // 2 — proposer cancelled before end
        Defeated,   // 3 — quorum not met OR against >= for
        Succeeded,  // 4 — quorum met, for > against
        Queued,     // 5 — waiting for timelock (optional)
        Executed    // 6 — proposal actions executed
    }

    struct Proposal {
        uint256 id;
        address proposer;
        string  description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        uint256 startBlock;
        uint256 endBlock;
        bool    executed;
        bool    canceled;
    }

    // ---- Constants ----

    uint256 public constant VOTING_DELAY  = 1;          // blocks
    uint256 public constant VOTING_PERIOD = 50_400;     // ~1 week
    uint256 public constant QUORUM_BPS    = 400;        // 4.00%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ---- State ----

    GovernanceToken public immutable token;

    uint256 private _proposalCount;
    mapping(uint256 => Proposal)                        private _proposals;
    mapping(uint256 => mapping(address => bool))        public  hasVoted;
    mapping(uint256 => mapping(address => uint8))       public  voteChoice;   // 0/1/2

    // ---- Events ----

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string  description,
        uint256 startBlock,
        uint256 endBlock
    );

    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        uint8   support,
        uint256 weight,
        string  reason
    );

    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);

    // ---- Constructor ----

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    // ---- Proposal Lifecycle ----

    /**
     * @notice Create a new proposal. Caller must hold > 0 delegated votes.
     * @param description Human-readable proposal text.
     * @return proposalId The ID of the newly created proposal.
     */
    function propose(string calldata description) external returns (uint256 proposalId) {
        uint256 voterVotes = token.getVotes(msg.sender);
        require(voterVotes > 0, "DAO: proposer lacks voting power");

        proposalId = _proposalCount++;

        uint256 startBlock = block.number + VOTING_DELAY;
        uint256 endBlock   = startBlock + VOTING_PERIOD;

        _proposals[proposalId] = Proposal({
            id:           proposalId,
            proposer:     msg.sender,
            description:  description,
            forVotes:     0,
            againstVotes: 0,
            abstainVotes: 0,
            startBlock:   startBlock,
            endBlock:     endBlock,
            executed:     false,
            canceled:     false
        });

        emit ProposalCreated(proposalId, msg.sender, description, startBlock, endBlock);
    }

    /**
     * @notice Cast a vote on an active proposal.
     * @param proposalId  The proposal to vote on.
     * @param support     0 = Against, 1 = For, 2 = Abstain.
     */
    function castVote(uint256 proposalId, uint8 support) external {
        castVoteWithReason(proposalId, support, "");
    }

    /**
     * @notice Cast a vote with an optional reason string.
     */
    function castVoteWithReason(uint256 proposalId, uint8 support, string memory reason) public {
        require(getProposalState(proposalId) == ProposalState.Active, "DAO: proposal not active");
        require(!hasVoted[proposalId][msg.sender], "DAO: already voted");
        require(support <= 2, "DAO: invalid support value");

        Proposal storage p = _proposals[proposalId];

        // Voting weight is snapshot at startBlock - 1 (= block before delay ends)
        uint256 weight = token.getPastVotes(msg.sender, p.startBlock - 1);
        require(weight > 0, "DAO: no voting power at snapshot");

        hasVoted[proposalId][msg.sender]  = true;
        voteChoice[proposalId][msg.sender] = support;

        if (support == 0) {
            p.againstVotes += weight;
        } else if (support == 1) {
            p.forVotes += weight;
        } else {
            p.abstainVotes += weight;
        }

        emit VoteCast(msg.sender, proposalId, support, weight, reason);
    }

    /**
     * @notice Execute a succeeded proposal.
     */
    function execute(uint256 proposalId) external {
        require(getProposalState(proposalId) == ProposalState.Succeeded, "DAO: proposal not succeeded");
        _proposals[proposalId].executed = true;
        emit ProposalExecuted(proposalId);
        // In a real deployment, execute on-chain calls here.
    }

    /**
     * @notice Cancel a proposal. Only the proposer can cancel while Pending.
     */
    function cancel(uint256 proposalId) external {
        ProposalState state = getProposalState(proposalId);
        require(
            state == ProposalState.Pending || state == ProposalState.Active,
            "DAO: cannot cancel"
        );
        require(_proposals[proposalId].proposer == msg.sender, "DAO: not proposer");
        _proposals[proposalId].canceled = true;
        emit ProposalCanceled(proposalId);
    }

    // ---- View Functions ----

    /**
     * @notice Compute the current on-chain state of a proposal.
     */
    function getProposalState(uint256 proposalId) public view returns (ProposalState) {
        require(proposalId < _proposalCount, "DAO: unknown proposal");

        Proposal storage p = _proposals[proposalId];

        if (p.canceled) return ProposalState.Canceled;
        if (p.executed) return ProposalState.Executed;

        if (block.number <= p.startBlock) return ProposalState.Pending;
        if (block.number <= p.endBlock)   return ProposalState.Active;

        // Post vote window — evaluate outcome
        uint256 snapshotBlock = p.startBlock - 1;
        uint256 supply        = token.getPastTotalSupply(snapshotBlock);
        uint256 quorum        = (supply * QUORUM_BPS) / BPS_DENOMINATOR;

        uint256 totalCast = p.forVotes + p.againstVotes + p.abstainVotes;
        bool quorumMet    = totalCast >= quorum;
        bool majorityFor  = p.forVotes > p.againstVotes;

        if (!quorumMet || !majorityFor) return ProposalState.Defeated;
        return ProposalState.Succeeded;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        require(proposalId < _proposalCount, "DAO: unknown proposal");
        return _proposals[proposalId];
    }

    function getProposalCount() external view returns (uint256) {
        return _proposalCount;
    }

    /**
     * @notice Quorum votes required at the given block's total supply.
     */
    function quorumVotes(uint256 blockNumber) external view returns (uint256) {
        return (token.getPastTotalSupply(blockNumber) * QUORUM_BPS) / BPS_DENOMINATOR;
    }
}
