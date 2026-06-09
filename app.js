'use strict';

// ============================================================
//  CONFIG
// ============================================================

const CONTRACT_ADDRESS = '0x92382d1d6d19095217b4de2a8edf452f1e6c55fc';
const QUORUM_VOTES     = 10;
const SEPOLIA_CHAIN_ID = '0xaa36a7';
const SEPOLIA_CHAIN_ID_DEC = 11155111;

const CONTRACT_ABI = [
  { inputs: [{ internalType: 'address', name: '_member', type: 'address' }], name: 'addMember', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'string', name: '_description', type: 'string' }], name: 'createProposal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'uint256', name: 'proposalId', type: 'uint256' }, { indexed: false, internalType: 'string', name: 'description', type: 'string' }], name: 'ProposalCreated', type: 'event' },
  { inputs: [{ internalType: 'uint256', name: '_proposalId', type: 'uint256' }], name: 'vote', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'uint256', name: 'proposalId', type: 'uint256' }, { indexed: false, internalType: 'address', name: 'voter', type: 'address' }], name: 'Voted', type: 'event' },
  { inputs: [{ internalType: 'uint256', name: '_proposalId', type: 'uint256' }], name: 'getProposal', outputs: [{ internalType: 'string', name: '', type: 'string' }, { internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getProposalCount', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'members', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], name: 'proposals', outputs: [{ internalType: 'string', name: 'description', type: 'string' }, { internalType: 'uint256', name: 'voteCount', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

// ============================================================
//  STATE
// ============================================================

let provider     = null;
let signer       = null;
let contract     = null;
let userAddress  = null;
let isMember     = false;
let isOwner      = false;
let isCorrectNetwork = false;
let activeTab    = 'active';
let proposals    = [];
let dropdownOpen = false;

// ============================================================
//  DOM REFS
// ============================================================

const connectBtn         = document.getElementById('connectBtn');
const walletMenu         = document.getElementById('walletMenu');
const walletMenuBtn      = document.getElementById('walletMenuBtn');
const walletDropdown     = document.getElementById('walletDropdown');
const walletAddressEl    = document.getElementById('walletAddress');
const walletDropdownFull = document.getElementById('walletDropdownFull');
const copyAddressBtn     = document.getElementById('copyAddressBtn');
const viewExplorerBtn    = document.getElementById('viewExplorerBtn');
const disconnectBtn      = document.getElementById('disconnectBtn');
const votingPowerChip    = document.getElementById('votingPower');
const totalProposalsEl   = document.getElementById('totalProposals');
const activeProposalsEl  = document.getElementById('activeProposals');
const myVotingPowerEl    = document.getElementById('myVotingPower');
const quorumDisplayEl    = document.getElementById('quorumDisplay');
const proposalsContainer = document.getElementById('proposalsContainer');
const createProposalBtn  = document.getElementById('createProposalBtn');
const refreshBtn         = document.getElementById('refreshBtn');
const modalOverlay       = document.getElementById('modalOverlay');
const proposalModal      = document.getElementById('proposalModal');
const closeModalBtn      = document.getElementById('closeModalBtn');
const cancelModalBtn     = document.getElementById('cancelModalBtn');
const submitProposalBtn  = document.getElementById('submitProposalBtn');
const proposalDescInput  = document.getElementById('proposalDesc');
const toastContainer     = document.getElementById('toastContainer');
const tabButtons         = document.querySelectorAll('.tab-btn');
const adminPanel         = document.getElementById('adminPanel');
const memberAddressInput = document.getElementById('memberAddressInput');
const addMemberBtn       = document.getElementById('addMemberBtn');
const addSelfBtn         = document.getElementById('addSelfBtn');
const networkBanner      = document.getElementById('networkBanner');
const switchNetworkBtn   = document.getElementById('switchNetworkBtn');

// ============================================================
//  INIT
// ============================================================

async function init() {
  quorumDisplayEl.textContent = `${QUORUM_VOTES} Votes`;

  if (!window.ethereum) {
    showToast('MetaMask not detected. Install MetaMask to use this app.', 'error');
    connectBtn.disabled = true;
    connectBtn.textContent = 'No Wallet';
    return;
  }

  provider = new ethers.providers.Web3Provider(window.ethereum);

  // Auto-connect if already authorised
  try {
    const accounts = await provider.listAccounts();
    if (accounts.length > 0) {
      await onConnected(accounts[0]);
    }
  } catch (_) {}

  window.ethereum.on('accountsChanged', handleAccountsChanged);
  window.ethereum.on('chainChanged', handleChainChanged);
}

// ============================================================
//  NETWORK
// ============================================================

async function checkNetwork() {
  const network = await provider.getNetwork();
  isCorrectNetwork = network.chainId === SEPOLIA_CHAIN_ID_DEC;
  networkBanner.style.display = isCorrectNetwork ? 'none' : 'flex';
  return isCorrectNetwork;
}

async function switchToSepolia() {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
  } catch (err) {
    if (err.code === 4902) {
      // Chain not added — add it
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: SEPOLIA_CHAIN_ID,
            chainName: 'Sepolia Testnet',
            nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://rpc.sepolia.org'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
      } catch (addErr) {
        showToast('Failed to add Sepolia network.', 'error');
      }
    } else if (err.code !== 4001) {
      showToast('Failed to switch network.', 'error');
    }
  }
}

// ============================================================
//  WALLET CONNECT / DISCONNECT
// ============================================================

async function connectWallet() {
  if (!window.ethereum) {
    showToast('MetaMask not detected.', 'error');
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const s       = provider.getSigner();
    const address = await s.getAddress();
    await onConnected(address);
  } catch (err) {
    console.error('connectWallet:', err);
    if (err.code !== 4001) showToast('Wallet connection failed.', 'error');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Wallet';
  }
}

async function onConnected(address) {
  userAddress = address;
  provider    = new ethers.providers.Web3Provider(window.ethereum);
  signer      = provider.getSigner();
  contract    = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  // Update header UI
  connectBtn.style.display          = 'none';
  walletMenu.style.display          = 'block';
  walletAddressEl.textContent       = truncateAddress(address);
  walletDropdownFull.textContent    = address;
  viewExplorerBtn.onclick           = () => window.open(`https://sepolia.etherscan.io/address/${address}`, '_blank');

  const correct = await checkNetwork();
  if (!correct) {
    showToast('Switch to Sepolia testnet to interact with the contract.', 'error');
  }

  await checkMembership();
  await loadProposals();
  subscribeToEvents();
}

function disconnectWallet() {
  // Clear local state (MetaMask doesn't expose a revoke API)
  userAddress  = null;
  signer       = null;
  contract     = null;
  isMember     = false;
  isOwner      = false;
  proposals    = [];

  connectBtn.style.display          = 'block';
  connectBtn.disabled               = false;
  connectBtn.textContent            = 'Connect Wallet';
  walletMenu.style.display          = 'none';
  closeDropdown();

  networkBanner.style.display       = 'none';
  adminPanel.style.display          = 'none';
  myVotingPowerEl.textContent       = '—';
  votingPowerChip.textContent       = '0 Votes';
  totalProposalsEl.textContent      = '—';
  activeProposalsEl.textContent     = '—';
  createProposalBtn.disabled        = true;

  renderProposals();
  showToast('Wallet disconnected.', 'success');
}

function handleAccountsChanged(accounts) {
  if (accounts.length === 0) {
    disconnectWallet();
  } else if (accounts[0].toLowerCase() !== userAddress?.toLowerCase()) {
    showToast('Account changed — reconnecting.', 'pending');
    onConnected(accounts[0]);
  }
}

function handleChainChanged() {
  // Reload is the safest approach — provider state is stale after chain change
  window.location.reload();
}

// ============================================================
//  WALLET DROPDOWN
// ============================================================

function toggleDropdown() {
  dropdownOpen = !dropdownOpen;
  walletDropdown.style.display = dropdownOpen ? 'block' : 'none';
  walletMenuBtn.setAttribute('aria-expanded', String(dropdownOpen));
}

function closeDropdown() {
  dropdownOpen = false;
  walletDropdown.style.display = 'none';
  walletMenuBtn.setAttribute('aria-expanded', 'false');
}

async function copyAddress() {
  if (!userAddress) return;
  try {
    await navigator.clipboard.writeText(userAddress);
    showToast('Address copied to clipboard.', 'success');
  } catch (_) {
    showToast('Copy failed — please copy manually.', 'error');
  }
  closeDropdown();
}

// ============================================================
//  MEMBERSHIP
// ============================================================

async function checkMembership() {
  if (!contract || !userAddress) return;

  try {
    [isMember, isOwner] = await Promise.all([
      contract.members(userAddress),
      contract.owner().then((o) => o.toLowerCase() === userAddress.toLowerCase()),
    ]);
  } catch (err) {
    console.error('checkMembership:', err);
    isMember = false;
    isOwner  = false;
  }

  const power = isMember ? '1' : '0';
  myVotingPowerEl.textContent  = power;
  votingPowerChip.textContent  = `${power} Vote${isMember ? '' : 's'}`;
  createProposalBtn.disabled   = !isMember;
  createProposalBtn.title      = isMember ? '' : 'You must be a DAO member to create proposals';

  if (adminPanel) adminPanel.style.display = isOwner ? 'block' : 'none';
}

// ============================================================
//  OWNER: ADD MEMBER
// ============================================================

async function addMember(address) {
  if (!contract || !isOwner) {
    showToast('Only the contract owner can add members.', 'error');
    return;
  }
  if (!ethers.utils.isAddress(address)) {
    showToast('Invalid Ethereum address.', 'error');
    return;
  }

  addMemberBtn.disabled = true;
  addSelfBtn.disabled   = true;

  const pendingId = showToast(`Adding ${truncateAddress(address)} as member — confirm in MetaMask…`, 'pending');

  try {
    const tx = await contract.addMember(address);
    dismissToast(pendingId);
    const waitId = showToast('Transaction submitted — awaiting confirmation…', 'pending');
    await tx.wait();
    dismissToast(waitId);
    showToast('Member added successfully!', 'success');
    memberAddressInput.value = '';
    await checkMembership();
  } catch (err) {
    dismissToast(pendingId);
    if (err?.code === 4001) {
      showToast('Transaction rejected.', 'error');
    } else {
      showToast(`Failed: ${truncateError(err?.reason || err?.message || 'Unknown error')}`, 'error');
    }
  } finally {
    addMemberBtn.disabled = false;
    addSelfBtn.disabled   = false;
  }
}

// ============================================================
//  PROPOSALS: READ
// ============================================================

async function loadProposals() {
  if (!contract) {
    proposalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#x1F4CB;</div>
        <p>Connect your wallet to view proposals.</p>
      </div>`;
    return;
  }

  if (!isCorrectNetwork) {
    proposalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Switch to Sepolia testnet to load proposals.</p>
      </div>`;
    return;
  }

  refreshBtn.classList.add('spinning');
  proposalsContainer.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      Loading proposals…
    </div>`;

  try {
    const countBN = await contract.getProposalCount();
    const total   = countBN.toNumber();

    const fetched = [];
    for (let i = 0; i < total; i++) {
      try {
        const result   = await contract.getProposal(i);
        const hasVoted = await queryHasVoted(i);
        fetched.push({
          id:          i,
          description: result[0],
          voteCount:   result[1].toNumber(),
          state:       'active',
          hasVoted,
        });
      } catch (err) {
        console.error(`getProposal(${i}):`, err);
      }
    }

    proposals = fetched;
    syncStats();
    renderProposals();
  } catch (err) {
    console.error('loadProposals:', err);
    proposalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#x26A0;</div>
        <p>Failed to load proposals. Make sure MetaMask is on <strong>Sepolia</strong>.</p>
      </div>`;
    totalProposalsEl.textContent  = '—';
    activeProposalsEl.textContent = '—';
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

async function queryHasVoted(proposalId) {
  if (!contract || !userAddress) return false;
  try {
    const filter = contract.filters.Voted();
    const events = await contract.queryFilter(filter);
    return events.some(
      (e) =>
        e.args.proposalId.toNumber() === proposalId &&
        e.args.voter.toLowerCase() === userAddress.toLowerCase()
    );
  } catch (_) {
    return false;
  }
}

function syncStats() {
  totalProposalsEl.textContent  = proposals.length;
  activeProposalsEl.textContent = proposals.filter((p) => p.state === 'active').length;
}

// ============================================================
//  PROPOSALS: WRITE
// ============================================================

async function castVote(proposalId, support) {
  if (!contract) { showToast('Connect your wallet first.', 'error'); return; }
  if (!isMember) { showToast('You must be a DAO member to vote.', 'error'); return; }

  const proposal = proposals.find((p) => p.id === proposalId);
  if (proposal?.hasVoted) { showToast('You have already voted on this proposal.', 'error'); return; }

  setVoteButtonsDisabled(proposalId, true);
  const pendingId = showToast(`Casting vote — confirm in MetaMask…`, 'pending');

  try {
    const tx = await contract.vote(proposalId);
    dismissToast(pendingId);
    const waitId = showToast('Transaction submitted — awaiting confirmation…', 'pending');
    await tx.wait();
    dismissToast(waitId);
    showToast('Vote cast successfully!', 'success');

    if (proposal) {
      proposal.hasVoted  = true;
      proposal.voteCount += 1;
    }
    syncStats();
    renderProposals();
  } catch (err) {
    dismissToast(pendingId);
    const msg = err?.reason || err?.data?.message || err?.message || '';
    if (msg.toLowerCase().includes('already voted')) {
      showToast('You have already voted on this proposal.', 'error');
      if (proposal) proposal.hasVoted = true;
    } else if (err?.code === 4001) {
      showToast('Transaction rejected.', 'error');
    } else {
      showToast(`Vote failed: ${truncateError(msg)}`, 'error');
    }
    setVoteButtonsDisabled(proposalId, false);
    renderProposals();
  }
}

async function createProposal() {
  const description = proposalDescInput.value.trim();
  if (!description) { showToast('Please enter a proposal description.', 'error'); proposalDescInput.focus(); return; }
  if (!isMember) { showToast('Only DAO members can create proposals.', 'error'); return; }

  submitProposalBtn.disabled = true;
  submitProposalBtn.textContent = 'Submitting…';

  const pendingId = showToast('Creating proposal — confirm in MetaMask…', 'pending');

  try {
    const tx = await contract.createProposal(description);
    dismissToast(pendingId);
    const waitId = showToast('Transaction submitted — awaiting confirmation…', 'pending');
    await tx.wait();
    dismissToast(waitId);
    showToast('Proposal created successfully!', 'success');
    closeModal();
    proposalDescInput.value = '';
    await loadProposals();
  } catch (err) {
    dismissToast(pendingId);
    if (err?.code === 4001) {
      showToast('Transaction rejected.', 'error');
    } else {
      showToast(`Failed: ${truncateError(err?.reason || err?.message || 'Unknown error')}`, 'error');
    }
  } finally {
    submitProposalBtn.disabled = false;
    submitProposalBtn.textContent = 'Submit Proposal';
  }
}

// ============================================================
//  RENDER
// ============================================================

function renderProposals() {
  const filtered = proposals.filter((p) => {
    switch (activeTab) {
      case 'active':    return p.state === 'active';
      case 'pending':   return p.state === 'pending';
      case 'succeeded': return p.state === 'succeeded';
      case 'defeated':  return p.state === 'defeated';
      default:          return true;
    }
  });

  if (filtered.length === 0) {
    proposalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#x1F5F3;&#xFE0F;</div>
        <p>No ${activeTab} proposals.</p>
        ${activeTab === 'active' && isMember ? '<p>Create the first proposal to get started.</p>' : ''}
      </div>`;
    return;
  }

  proposalsContainer.innerHTML = filtered
    .slice()
    .reverse()
    .map((p) => renderProposalCard(p))
    .join('');
}

function renderProposalCard(proposal) {
  const { id, description, voteCount, state, hasVoted } = proposal;

  const forVotes = voteCount;
  const totalVotes = forVotes;
  const forPct = totalVotes > 0 ? 100 : 0;
  const quorumPct = Math.min(Math.round((voteCount / QUORUM_VOTES) * 100), 100);
  const quorumMet = voteCount >= QUORUM_VOTES;
  const canVote = isMember && !hasVoted && state === 'active';

  return `
    <article class="proposal-card" id="proposal-${id}" role="listitem">
      <div class="proposal-header">
        <div class="proposal-meta">
          <span class="proposal-id">#${String(id + 1).padStart(3, '0')}</span>
          <span class="state-badge state-${state}">${capitalise(state)}</span>
        </div>
        <span class="proposal-votes-summary">${voteCount} vote${voteCount !== 1 ? 's' : ''}</span>
      </div>

      <div class="proposal-description">
        <p>${escapeHtml(description)}</p>
      </div>

      <div class="vote-bars" role="group" aria-label="Vote breakdown">
        <div class="vote-bar-row">
          <div class="vote-bar-label">
            <span class="vote-label-dot for-dot"></span>
            <span>For</span>
          </div>
          <div class="vote-bar-track" role="progressbar" aria-valuenow="${forPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="vote-bar-fill for-fill" style="width:${forPct}%"></div>
          </div>
          <div class="vote-bar-count">${forVotes} <span class="vote-pct">(${forPct}%)</span></div>
        </div>
        <div class="vote-bar-row">
          <div class="vote-bar-label">
            <span class="vote-label-dot against-dot"></span>
            <span>Against</span>
          </div>
          <div class="vote-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="vote-bar-fill against-fill" style="width:0%"></div>
          </div>
          <div class="vote-bar-count">0 <span class="vote-pct">(0%)</span></div>
        </div>
        <div class="vote-bar-row">
          <div class="vote-bar-label">
            <span class="vote-label-dot abstain-dot"></span>
            <span>Abstain</span>
          </div>
          <div class="vote-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="vote-bar-fill abstain-fill" style="width:0%"></div>
          </div>
          <div class="vote-bar-count">0 <span class="vote-pct">(0%)</span></div>
        </div>
      </div>

      <div class="quorum-section">
        <div class="quorum-header">
          <span class="quorum-label">Quorum Progress</span>
          <span class="quorum-status${quorumMet ? ' quorum-met' : ''}">
            ${quorumMet ? 'Met ✓' : `${voteCount} / ${QUORUM_VOTES} votes`}
          </span>
        </div>
        <div class="quorum-bar-track" role="progressbar" aria-valuenow="${quorumPct}" aria-valuemin="0" aria-valuemax="100">
          <div class="quorum-bar-fill" style="width:${quorumPct}%"></div>
        </div>
      </div>

      <div class="proposal-footer">
        <div class="proposal-info">
          <span class="info-label">Proposal</span>
          <span class="info-value">#${id}</span>
        </div>

        ${canVote ? `
          <div class="vote-buttons" id="vote-btns-${id}">
            <button class="vote-btn for-btn"     onclick="castVote(${id}, 1)">Vote For</button>
            <button class="vote-btn against-btn" onclick="castVote(${id}, 0)">Vote Against</button>
            <button class="vote-btn abstain-btn" onclick="castVote(${id}, 2)">Abstain</button>
          </div>
        ` : hasVoted ? `
          <div class="voted-badge">&#x2713; You voted</div>
        ` : !isMember ? `
          <div class="not-member-badge">Members only</div>
        ` : `
          <div class="closed-badge">Voting closed</div>
        `}
      </div>
    </article>
  `;
}

function setVoteButtonsDisabled(proposalId, disabled) {
  const container = document.getElementById(`vote-btns-${proposalId}`);
  if (!container) return;
  container.querySelectorAll('button').forEach((btn) => { btn.disabled = disabled; });
}

// ============================================================
//  TABS
// ============================================================

function setActiveTab(tab) {
  activeTab = tab;
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  renderProposals();
}

// ============================================================
//  MODAL
// ============================================================

function openModal() {
  if (!isMember) { showToast('Only DAO members can create proposals.', 'error'); return; }
  proposalModal.classList.add('open');
  modalOverlay.classList.add('open');
  proposalModal.setAttribute('aria-hidden', 'false');
  modalOverlay.setAttribute('aria-hidden', 'false');
  proposalDescInput.focus();
}

function closeModal() {
  proposalModal.classList.remove('open');
  modalOverlay.classList.remove('open');
  proposalModal.setAttribute('aria-hidden', 'true');
  modalOverlay.setAttribute('aria-hidden', 'true');
}

// ============================================================
//  REAL-TIME EVENTS
// ============================================================

function subscribeToEvents() {
  if (!contract) return;

  contract.on('Voted', (proposalId, voter) => {
    const id       = proposalId.toNumber();
    const proposal = proposals.find((p) => p.id === id);
    if (proposal) {
      proposal.voteCount += 1;
      if (voter.toLowerCase() === userAddress?.toLowerCase()) proposal.hasVoted = true;
    }
    syncStats();
    renderProposals();
    if (voter.toLowerCase() !== userAddress?.toLowerCase()) {
      showToast(`New vote on proposal #${id + 1}`, 'pending');
    }
  });

  contract.on('ProposalCreated', async (proposalId, description) => {
    const id = proposalId.toNumber();
    if (proposals.find((p) => p.id === id)) return;
    const hasVoted = await queryHasVoted(id);
    proposals.push({ id, description, voteCount: 0, state: 'active', hasVoted });
    syncStats();
    renderProposals();
    const preview = description.length > 44 ? description.substring(0, 44) + '…' : description;
    showToast(`New proposal: "${preview}"`, 'success');
  });
}

// ============================================================
//  TOAST
// ============================================================

let _toastCounter = 0;

function showToast(message, type = 'pending') {
  const id   = `toast-${++_toastCounter}`;
  const icon = { pending: '⏳', success: '✓', error: '✕' }[type] ?? '•';

  const el     = document.createElement('div');
  el.id        = id;
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="dismissToast('${id}')" aria-label="Dismiss">&#x2715;</button>
  `;

  toastContainer.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-show')));
  if (type !== 'pending') setTimeout(() => dismissToast(id), 4000);
  return id;
}

function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('toast-show');
  el.classList.add('toast-hide');
  setTimeout(() => el.remove(), 320);
}

// ============================================================
//  UTILITIES
// ============================================================

function truncateAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function truncateError(msg) {
  return msg.length > 80 ? msg.substring(0, 80) + '…' : msg;
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============================================================
//  EVENT WIRING
// ============================================================

connectBtn.addEventListener('click', connectWallet);
walletMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });
copyAddressBtn.addEventListener('click', copyAddress);
disconnectBtn.addEventListener('click', disconnectWallet);
switchNetworkBtn.addEventListener('click', switchToSepolia);
refreshBtn.addEventListener('click', loadProposals);

if (addMemberBtn) addMemberBtn.addEventListener('click', () => addMember(memberAddressInput.value.trim()));
if (addSelfBtn)   addSelfBtn.addEventListener('click', () => { if (userAddress) addMember(userAddress); else showToast('Connect your wallet first.', 'error'); });
if (memberAddressInput) memberAddressInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMember(memberAddressInput.value.trim()); });

createProposalBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);
submitProposalBtn.addEventListener('click', createProposal);

proposalDescInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); createProposal(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (proposalModal.classList.contains('open')) closeModal();
    if (dropdownOpen) closeDropdown();
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (dropdownOpen && !document.getElementById('walletWrapper').contains(e.target)) {
    closeDropdown();
  }
});

tabButtons.forEach((btn) => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));

// ============================================================
//  BOOT
// ============================================================

init();
