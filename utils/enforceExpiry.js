// utils/enforceExpiry.js
const User = require('../models/usermodels');
const Farm = require('../models/farmModel');
const ContractorRequest = require('../models/contractorRequestModel');
const { LIMITS } = require('./limits');

async function enforceExpiry(userId) {
  const user = await User.findById(userId);
  if (!user) return;

  // إن كان أساسًا Basic أو لا يوجد تاريخ انتهاء أو لم ينتهِ بعد → لا شيء
  if (user.subscriptionTier === 'Basic') return;
  if (!user.subscriptionUntil || user.subscriptionUntil > new Date()) return;

  // انتهت المدة → رجّع Basic وامسح التاريخ
  user.subscriptionTier = 'Basic';
  user.plan = 'Basic';
  user.subscriptionUntil = null;
  await user.save();

  // (اختياري) رفض المعلّق الزائد عن حد Basic
  const now = new Date();

  // أراضي
  const basicFarmLimit = LIMITS.Basic.farms; // 1
  const approvedFarms = await Farm.countDocuments({ owner:userId, status:'approved' });
  const roomFarms = Math.max(0, basicFarmLimit - approvedFarms);
  const pendFarms = await Farm.find({ owner:userId, status:'pending' }).sort({ createdAt:1 });
  for (const f of pendFarms.slice(roomFarms)) {
    await Farm.updateOne({_id:f._id}, { status:'rejected', rejectedAt:now, reviewNote:'انتهت صلاحية الاشتراك' });
  }

  // مقاول
  const basicCtrLimit = LIMITS.Basic.contractors; // 1
  const approvedCtr = await ContractorRequest.countDocuments({ user:userId, status:'approved' });
  const roomCtr = Math.max(0, basicCtrLimit - approvedCtr);
  const pendCtr = await ContractorRequest.find({ user:userId, status:'pending' }).sort({ createdAt:1 });
  for (const c of pendCtr.slice(roomCtr)) {
    await ContractorRequest.updateOne({_id:c._id}, { status:'rejected', rejectedAt:now, reviewNote:'انتهت صلاحية الاشتراك' });
  }
}

module.exports = { enforceExpiry };
