/* ============================================================
   DAO Governance — Frontend Application
   Chain:    Sepolia testnet
   Ethers:   5.7.x (UMD build via CDN)

   NOTE: The deployed contract at CONTRACT_ADDRESS is a simple
   DAO with a single vote() function and no For/Against/Abstain
   support at the Solidity level. The aspirational full-featured
   contract is in contracts/DAO.sol (not yet deployed). The UI
   renders all votes as "For" votes against the current contract;
   the three vote buttons all call vote() on-chain. Upgrade the
   contract address and ABI when the new contract is deployed.
============================================================ */

'use strict';

// ============================================================
//  CONSTANTS & CONFIG
// ============================================================

const CONTRACT_ADDRESS = '0x92382d1d6d19095217b4de2a8edf452f1e6c55fc';
const QUORUM_VOTES     = 10;   // votes needed for quorum (local threshold)
const SEPOLIA_CHAIN_ID = '0xaa36a7';

/** ABI matching the deployed Sepolia contract. */
const CONTRACT_ABI = [
  {
    inputs: [{ internalType: 'address', name: '_member', type: 'address' }],
    name: 'addMember',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: '_description', type: 'string' }],
    name: 'createProposal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'proposalId', type: 'uint256' },
      { indexed: false, internalType: 'string',  name: 'description', type: 'string'  },
    ],
    name: 'ProposalCreated',
    type: 'event',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_proposalId', type: 'uint256' }],
    name: 'vote',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint256', name: 'proposalId', type: 'uint256' },
      { indexed: false, internalType: 'address', name: 'voter',      type: 'address' },
    ],
    name: 'Voted',
    type: 'event',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_proposalId', type: 'uint256' }],
    name: 'getProposal',
    outputs: [
      { internalType: 'string',  name: '', type: 'string'  },
      { internalType: 'uint256', name: '', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getProposalCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'members',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'proposals',
    outputs: [
      { internalType: 'string',  name: 'description', type: 'string'  },
      { internalType: 'uint256', name: 'voteCount',    type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

// ============================================================
//  APPLICATION STATE
// ============================================================

let provider    = null;
let signer      = null;
let contract    = null;
let userAddress = null;
let isMember    = false;
let activeTab   = 'active';
let proposals   = [];  // Array<{ id, description, voteCount, state, hasVoted }>

// ============================================================
//  DOM REFERENCES
// ============================================================

const connectBtn        = document.getElementById('connectBtn');
const votingPowerChip   = document.getElementById('votingPower');
const totalProposalsEl  = document.getElementById('totalProposals');
const activeProposalsEl = document.getElementById('activeProposals');
const myVotingPowerEl   = document.getElementById('myVotingPower');
const quorumDisplayEl   = document.getElementById('quorumDisplay');
const proposalsContainer = document.getElementById('proposalsContainer');
const createProposalBtn = document.getElementById('createProposalBtn');
const modalOverlay      = document.getElementById('modalOverlay');
const proposalModal     = document.getElementById('proposalModal');
const closeModalBtn     = document.getElementById('closeModalBtn');
const cancelModalBtn    = document.getElementById('cancelModalBtn');
const submitProposalBtn = document.getElementById('submitProposalBtn');
const proposalDescInput = document.getElementById('proposalDesc');
const toastContainer    = document.getElementById('toastContainer');
const tabButtons        = document.querySelectorAll('.tab-btn');

// ============================================================
//  INITIALIZATION
// ============================================================

async function init() {
  // Display static quorum info
  quorumDisplayEl.textContent = `${QUORUM_VOTES} Votes`;

  if (!window.ethereum) {
    showToast('MetaMask not detected. Install MetaMask to continue.', 'error');
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
  } catch (_) { /* not connected yet */ }

  // MetaMask event hooks
  window.ethereum.on('accountsChanged', handleAccountsChanged);
  window.ethereum.on('chainChanged',    handleChainChanged);
}

// ============================================================
//  WALLET
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
    showToast('Wallet connection cancelled or failed.', 'error');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Wallet';
  }
}

async function onConnected(address) {
  userAddress = address;
  provider    = new ethers.providers.Web3Provider(window.ethereum);
  signer      = provider.getSigner();
  contract    = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  // Header button
  connectBtn.classList.add('connected');
  connectBtn.innerHTML = `<span class="btn-dot connected-dot"></span>${truncateAddress(address)}`;
  connectBtn.disabled  = false;

  await checkMembership();
  await loadProposals();
  subscribeToEvents();
}

async function checkMembership() {
  if (!contract || !userAddress) return;

  try {
    isMember = await contract.members(userAddress);
  } catch (err) {
    console.error('checkMembership:', err);
    isMember = false;
  }

  const power = isMember ? '1' : '0';
  myVotingPowerEl.textContent  = power;
  votingPowerChip.textContent  = `${power} Vote${isMember ? '' : 's'}`;
  createProposalBtn.disabled   = !isMember;

  if (!isMember) {
    createProposalBtn.title = 'You must be a DAO member to create proposals';
  } else {
    createProposalBtn.title = '';
  }
}

function handleAccountsChanged(accounts) {
  if (accounts.length === 0) {
    disconnectWallet();
    showToast('Wallet disconnected.', 'error');
  } else {
    showToast('Account changed — reloading data.', 'pending');
    onConnected(accounts[0]);
  }
}

function handleChainChanged() {
  showToast('Network changed — reloading page.', 'pending');
  window.location.reload();
}

function disconnectWallet() {
  userAddress = null;
  signer      = null;
  contract    = null;
  isMember    = false;
  proposals   = [];

  connectBtn.classList.remove('connected');
  connectBtn.innerHTML = 'Connect Wallet';
  connectBtn.disabled  = false;

  myVotingPowerEl.textContent = '—';
  votingPowerChip.textContent = '0 Votes';
  totalProposalsEl.textContent  = '—';
  activeProposalsEl.textContent = '—';
  createProposalBtn.disabled = true;

  renderProposals();
}

// ============================================================
//  CONTRACT READS
// ============================================================

async function loadProposals() {
  if (!contract) return;

  proposalsContainer.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      Loading proposals…
    </div>
  `;

  try {
    const countBN = await contract.getProposalCount();
    const total   = countBN.toNumber();

    totalProposalsEl.textContent = total;

    const fetched = [];

    for (let i = 0; i < total; i++) {
      try {
        const result    = await contract.getProposal(i);
        const hasVoted  = await queryHasVoted(i);

        fetched.push({
          id:          i,
          description: result[0],
          voteCount:   result[1].toNumber(),
          state:       'active',   // contract has no state tracking; all proposals are active
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
        <p>Failed to load proposals. Check your connection and try again.</p>
      </div>
    `;
  }
}

/**
 * Scan past Voted events to determine whether the connected
 * address has already voted on a given proposal.
 */
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
//  CONTRACT WRITES
// ============================================================

/**
 * Cast a vote on proposalId.
 * @param {number} proposalId
 * @param {0|1|2}  support  — 0 Against, 1 For, 2 Abstain
 *                            (all map to vote() on the deployed contract)
 */
async function castVote(proposalId, support) {
  if (!contract) {
    showToast('Connect your wallet first.', 'error');
    return;
  }
  if (!isMember) {
    showToast('You must be a DAO member to vote.', 'error');
    return;
  }

  const proposal = proposals.find((p) => p.id === proposalId);
  if (proposal?.hasVoted) {
    showToast('You have already voted on this proposal.', 'error');
    return;
  }

  const supportLabels = ['Against', 'For', 'Abstain'];
  setVoteButtonsDisabled(proposalId, true);

  const pendingId = showToast(
    `Casting "${supportLabels[support]}" vote — confirm in MetaMask…`,
    'pending'
  );

  try {
    const tx = await contract.vote(proposalId);
    dismissToast(pendingId);

    const waitId = showToast('Transaction submitted — awaiting confirmation…', 'pending');
    await tx.wait();
    dismissToast(waitId);

    showToast('Vote cast successfully!', 'success');

    // Optimistic local update
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
      showToast('Transaction rejected by user.', 'error');
    } else {
      showToast(`Vote failed: ${truncateError(msg)}`, 'error');
    }

    setVoteButtonsDisabled(proposalId, false);
    renderProposals();
  }
}

async function createProposal() {
  const description = proposalDescInput.value.trim();

  if (!description) {
    showToast('Please enter a proposal description.', 'error');
    proposalDescInput.focus();
    return;
  }
  if (!isMember) {
    showToast('Only DAO members can create proposals.', 'error');
    return;
  }

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
      showToast('Transaction rejected by user.', 'error');
    } else {
      const msg = err?.reason || err?.message || 'Unknown error';
      showToast(`Failed to create proposal: ${truncateError(msg)}`, 'error');
    }
  } finally {
    submitProposalBtn.disabled = false;
    submitProposalBtn.textContent = 'Submit Proposal';
  }
}

// ============================================================
//  UI RENDERING
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
    const hint =
      activeTab === 'active' && isMember
        ? '<p>Create the first proposal to get started.</p>'
        : '';

    proposalsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#x1F5F3;&#xFE0F;</div>
        <p>No ${activeTab} proposals.</p>
        ${hint}
      </div>
    `;
    return;
  }

  proposalsContainer.innerHTML = filtered
    .slice()
    .reverse()                              // newest first
    .map((p) => renderProposalCard(p))
    .join('');
}

function renderProposalCard(proposal) {
  const { id, description, voteCount, state, hasVoted } = proposal;

  // The deployed contract counts all votes as "support / For"
  const forVotes     = voteCount;
  const againstVotes = 0;
  const abstainVotes = 0;
  const totalVotes   = forVotes + againstVotes + abstainVotes;

  const forPct     = totalVotes > 0 ? Math.round((forVotes     / totalVotes) * 100) : 0;
  const againstPct = totalVotes > 0 ? Math.round((againstVotes / totalVotes) * 100) : 0;
  const abstainPct = totalVotes > 0 ? Math.round((abstainVotes / totalVotes) * 100) : 0;

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

      <!-- Vote bars -->
      <div class="vote-bars" role="group" aria-label="Vote breakdown">
        <div class="vote-bar-row">
          <div class="vote-bar-label">
            <span class="vote-label-dot for-dot" aria-hidden="true"></span>
            <span>For</span>
          </div>
          <div class="vote-bar-track" role="progressbar" aria-valuenow="${forPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="vote-bar-fill for-fill" style="width:${forPct}%"></div>
          </div>
          <div class="vote-bar-count">${forVotes} <span class="vote-pct">(${forPct}%)</span></div>
        </div>

        <div class="vote-bar-row">
          <div class="vote-bar-label">
            <span class="vote-label-dot against-dot" aria-hidden="true"></span>
            <span>Against</span>
          </div>
          <div class="vote-bar-track" role="progressbar" aria-valuenow="${againstPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="vote-bar-fill against-fill" style="width:${againstPct}%"></div>
          </div>
          <div class="vote-bar-count">${againstVotes} <span class="vote-pct">(${againstPct}%)</span></div>
        </div>

        <div class="vote-bar-row">
          <div class="vote-bar-label">
            <span class="vote-label-dot abstain-dot" aria-hidden="true"></span>
            <span>Abstain</span>
          </div>
          <div class="vote-bar-track" role="progressbar" aria-valuenow="${abstainPct}" aria-valuemin="0" aria-valuemax="100">
            <div class="vote-bar-fill abstain-fill" style="width:${abstainPct}%"></div>
          </div>
          <div class="vote-bar-count">${abstainVotes} <span class="vote-pct">(${abstainPct}%)</span></div>
        </div>
      </div>

      <!-- Quorum progress -->
      <div class="quorum-section">
        <div class="quorum-header">
          <span class="quorum-label">Quorum Progress</span>
          <span class="quorum-status${quorumMet ? ' quorum-met' : ''}">
            ${quorumMet ? 'Met ✓' : `${voteCount} / ${QUORUM_VOTES} votes`}
          </span>
        </div>
        <div class="quorum-bar-track"
             role="progressbar"
             aria-valuenow="${quorumPct}"
             aria-valuemin="0"
             aria-valuemax="100"
             aria-label="Quorum progress">
          <div class="quorum-bar-fill" style="width:${quorumPct}%"></div>
        </div>
      </div>

      <!-- Footer: info + actions -->
      <div class="proposal-footer">
        <div class="proposal-info">
          <span class="info-label">Proposal</span>
          <span class="info-value">#${id}</span>
        </div>

        ${canVote ? `
          <div class="vote-buttons" id="vote-btns-${id}" role="group" aria-label="Cast your vote">
            <button class="vote-btn for-btn"     onclick="castVote(${id}, 1)">Vote For</button>
            <button class="vote-btn against-btn" onclick="castVote(${id}, 0)">Vote Against</button>
            <button class="vote-btn abstain-btn" onclick="castVote(${id}, 2)">Abstain</button>
          </div>
        ` : hasVoted ? `
          <div class="voted-badge" aria-label="You already voted">&#x2713; You voted</div>
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
  container.querySelectorAll('button').forEach((btn) => {
    btn.disabled = disabled;
  });
}

// ============================================================
//  TAB NAVIGATION
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
  if (!isMember) {
    showToast('Only DAO members can create proposals.', 'error');
    return;
  }
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
//  TOAST NOTIFICATIONS
// ============================================================

let _toastCounter = 0;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'pending'|'success'|'error'} type
 * @returns {string} toast element id (use to dismiss early)
 */
function showToast(message, type = 'pending') {
  const id   = `toast-${++_toastCounter}`;
  const icon = { pending: '⏳', success: '✓', error: '✕' }[type] ?? '•';

  const el       = document.createElement('div');
  el.id          = id;
  el.className   = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML   = `
    <span class="toast-icon" aria-hidden="true">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="dismissToast('${id}')" aria-label="Dismiss notification">&#x2715;</button>
  `;

  toastContainer.appendChild(el);

  // Trigger slide-in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('toast-show'));
  });

  // Auto-dismiss after 4 s (keep 'pending' toasts until manually dismissed)
  if (type !== 'pending') {
    setTimeout(() => dismissToast(id), 4000);
  }

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
//  REAL-TIME EVENT SUBSCRIPTIONS
// ============================================================

function subscribeToEvents() {
  if (!contract) return;

  // Real-time vote updates
  contract.on('Voted', (proposalId, voter) => {
    const id       = proposalId.toNumber();
    const proposal = proposals.find((p) => p.id === id);

    if (proposal) {
      proposal.voteCount += 1;
      if (voter.toLowerCase() === userAddress?.toLowerCase()) {
        proposal.hasVoted = true;
      }
    }

    syncStats();
    renderProposals();

    // Notify about foreign votes
    if (voter.toLowerCase() !== userAddress?.toLowerCase()) {
      showToast(`New vote on proposal #${id + 1}`, 'pending');
    }
  });

  // New proposal created
  contract.on('ProposalCreated', async (proposalId, description) => {
    const id = proposalId.toNumber();

    // Don't duplicate if already in local state
    if (proposals.find((p) => p.id === id)) return;

    const hasVoted = await queryHasVoted(id);
    proposals.push({
      id,
      description,
      voteCount: 0,
      state:     'active',
      hasVoted,
    });

    syncStats();
    renderProposals();

    const preview = description.length > 44
      ? description.substring(0, 44) + '…'
      : description;
    showToast(`New proposal: "${preview}"`, 'success');
  });
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
//  EVENT WIRING
// ============================================================

connectBtn.addEventListener('click', connectWallet);

createProposalBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);
submitProposalBtn.addEventListener('click', createProposal);

// Allow Enter inside textarea to NOT submit (natural newline)
// but Ctrl/Cmd+Enter does submit
proposalDescInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    createProposal();
  }
});

// Escape closes modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && proposalModal.classList.contains('open')) {
    closeModal();
  }
});

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// ============================================================
//  BOOT
// ============================================================

init();
