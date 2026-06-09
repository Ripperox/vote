// Deploys GovernanceToken, then the DAO wired to that token.
//
//   bunx hardhat run scripts/deploy.js --network sepolia
//
// Requires SEPOLIA_RPC_URL and PRIVATE_KEY in the environment (see README).

const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account found. Set PRIVATE_KEY in your environment for live networks."
    );
  }

  console.log("Network:        ", network.name);
  console.log("Deployer:       ", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH\n");

  // 1) Governance token
  console.log("Deploying GovernanceToken...");
  const Token = await ethers.getContractFactory("GovernanceToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("  GovernanceToken deployed at:", tokenAddress);

  // 2) DAO governor, wired to the token
  console.log("Deploying DAO...");
  const DAO = await ethers.getContractFactory("DAO");
  const dao = await DAO.deploy(tokenAddress);
  await dao.waitForDeployment();
  const daoAddress = await dao.getAddress();
  console.log("  DAO deployed at:            ", daoAddress);

  console.log("\n================ Deployment summary ================");
  console.log("GovernanceToken:", tokenAddress);
  console.log("DAO:            ", daoAddress);
  console.log("====================================================");
  console.log(
    "\nNext step: update CONTRACT_ADDRESS in app.js with the DAO address above"
  );
  console.log(`  const CONTRACT_ADDRESS = '${daoAddress}';`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
