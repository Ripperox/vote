const { test, expect } = require("@playwright/test");

// All-digit address so that EIP-55 checksumming leaves the casing unchanged,
// making the truncated/full assertions deterministic.
const ACCOUNT = "0x1234567890123456789012345678901234567890";
const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111

// Injected before any page script runs. Provides a minimal EIP-1193 provider
// so the wallet-connection UI flow can be exercised without a real wallet.
// Contract read calls return "0x" and decode-fail inside the app (handled by
// its try/catch) — we only assert on the wallet UI, never on-chain data.
function mockWalletInit({ account, chainId }) {
  const state = { connected: false, account, chainId };
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      switch (method) {
        case "eth_chainId":
          return state.chainId;
        case "net_version":
          return String(parseInt(state.chainId, 16));
        case "eth_requestAccounts":
          state.connected = true;
          return [state.account];
        case "eth_accounts":
          return state.connected ? [state.account] : [];
        case "eth_blockNumber":
          return "0x1";
        case "eth_call":
          return "0x";
        case "eth_getLogs":
          return [];
        case "eth_estimateGas":
          return "0x5208";
        case "eth_gasPrice":
          return "0x3b9aca00";
        default:
          return null;
      }
    },
    on: () => {},
    removeListener: () => {},
  };
}

test.describe("UI shell (no wallet injected)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads with the DAO Governance title", async ({ page }) => {
    await expect(page).toHaveTitle("DAO Governance");
    await expect(page.locator(".header-title")).toHaveText("DAO Governance");
  });

  test("renders the four stats cards", async ({ page }) => {
    const cards = page.locator(".stat-card");
    await expect(cards).toHaveCount(4);
    await expect(page.locator(".stat-label")).toHaveText([
      "Total Proposals",
      "Active Proposals",
      "Your Voting Power",
      "Quorum Required",
    ]);
  });

  test("tab navigation switches the selected tab", async ({ page }) => {
    const active = page.locator('.tab-btn[data-tab="active"]');
    const pending = page.locator('.tab-btn[data-tab="pending"]');
    const succeeded = page.locator('.tab-btn[data-tab="succeeded"]');
    const defeated = page.locator('.tab-btn[data-tab="defeated"]');

    // Default selected tab is "active".
    await expect(active).toHaveAttribute("aria-selected", "true");
    await expect(pending).toHaveAttribute("aria-selected", "false");

    await pending.click();
    await expect(pending).toHaveAttribute("aria-selected", "true");
    await expect(active).toHaveAttribute("aria-selected", "false");

    await succeeded.click();
    await expect(succeeded).toHaveAttribute("aria-selected", "true");
    await expect(pending).toHaveAttribute("aria-selected", "false");

    await defeated.click();
    await expect(defeated).toHaveAttribute("aria-selected", "true");

    await active.click();
    await expect(active).toHaveAttribute("aria-selected", "true");
    await expect(defeated).toHaveAttribute("aria-selected", "false");
  });

  test("shows a MetaMask-not-detected toast and a No Wallet button", async ({ page }) => {
    await expect(page.locator(".toast-message")).toContainText("MetaMask not detected");
    const connectBtn = page.locator("#connectBtn");
    await expect(connectBtn).toHaveText("No Wallet");
    await expect(connectBtn).toBeDisabled();
  });
});

test.describe("Wallet connection flow (mocked window.ethereum)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(mockWalletInit, {
      account: ACCOUNT,
      chainId: SEPOLIA_CHAIN_ID,
    });
    await page.goto("/");
  });

  test("connects, opens the dropdown, and disconnects", async ({ page }) => {
    const connectBtn = page.locator("#connectBtn");
    const walletMenu = page.locator("#walletMenu");

    // Not auto-connected: eth_accounts returns [] until the user connects.
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toHaveText("Connect Wallet");
    await expect(walletMenu).toBeHidden();

    // Connect -> header switches to the connected wallet menu.
    await connectBtn.click();
    await expect(walletMenu).toBeVisible();
    await expect(connectBtn).toBeHidden();
    await expect(page.locator("#walletAddress")).toHaveText("0x1234…7890");

    // Open the dropdown and verify the menu items.
    const menuBtn = page.locator("#walletMenuBtn");
    await menuBtn.click();
    const dropdown = page.locator("#walletDropdown");
    await expect(dropdown).toBeVisible();
    await expect(menuBtn).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#walletDropdownFull")).toHaveText(ACCOUNT);
    await expect(page.locator("#copyAddressBtn")).toBeVisible();
    await expect(page.locator("#copyAddressBtn")).toContainText("Copy Address");
    await expect(page.locator("#viewExplorerBtn")).toContainText("View on Etherscan");
    await expect(page.locator("#disconnectBtn")).toContainText("Disconnect");

    // Disconnect -> header returns to the Connect button.
    await page.locator("#disconnectBtn").click();
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toHaveText("Connect Wallet");
    await expect(walletMenu).toBeHidden();
  });
});
