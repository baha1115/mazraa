// utils/quota.js
const User = require('../models/usermodels');
const Farm = require('../models/farmModel');
const ContractorRequest = require('../models/contractorRequestModel');
const LIMITS = require('./limits');

async function countUsed(userId, kind, { statuses = ['pending','approved'] } = {}) {
  if (kind === 'farm') {
    return Farm.countDocuments({ owner: userId, status: { $in: statuses } });
  }
  if (kind === 'contractor') {
    return ContractorRequest.countDocuments({ user: userId, status: { $in: statuses } });
  }
  return 0;
}

// opts.mode: 'create' (افتراضي) أو 'approve'
async function checkQuota(userId, kind, userDoc = null, opts = {}) {
  const mode = opts.mode || 'create';
  const user = userDoc || await User.findById(userId).lean();
  const tier = (user && user.subscriptionTier) || 'Basic';
  const limit = LIMITS[tier][kind === 'farm' ? 'farms' : 'contractors'];

  // في الموافقة نحسب الـ approved فقط
  const statuses = (mode === 'approve') ? ['approved'] : ['pending','approved'];
  const used = await countUsed(userId, kind, { statuses });

  // في الموافقة: يكفي أن يكون used(approved) < limit لنسمح بالموافقة
  return { ok: used < limit, used, limit, tier };
}

module.exports = { checkQuota, countUsed, LIMITS };
