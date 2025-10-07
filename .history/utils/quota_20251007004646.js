
const User = require('../models/User');
const Farm = require('../models/farmModel');
const ContractorRequest = require('../models/ContractorRequest');
const LIMITS = require('./limits');

async function countUsed(userId, kind) {
  if (kind === 'farm') {
    return Farm.countDocuments({ owner: userId, status: { $in: ['pending','approved'] } });
  }
  if (kind === 'contractor') {
    return ContractorRequest.countDocuments({ user: userId, status: { $in: ['pending','approved'] } });
  }
  return 0;
}

async function checkQuota(userId, kind, userDoc=null) {
  const user = userDoc || await User.findById(userId).lean();
  const tier = (user && user.subscriptionTier) || 'Basic';
  const limit = LIMITS[tier][kind === 'farm' ? 'farms' : 'contractors'];
  const used  = await countUsed(userId, kind);
  return { ok: used < limit, used, limit, tier };
}

module.exports = { checkQuota, countUsed, LIMITS };
