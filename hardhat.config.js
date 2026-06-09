require("@nomicfoundation/hardhat-toolbox");

// Read deployment secrets from the environment. These are only required when
// actually deploying to a live network — the config must still load (and
// `compile` / `test` must still run) when they are absent.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Local in-process network used by `hardhat test`.
    hardhat: {},
    // Sepolia testnet. Guarded so a missing RPC URL / key does not crash the
    // config: we fall back to a public RPC and an empty signer set, which only
    // matters if you actually try to broadcast a transaction.
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
};
