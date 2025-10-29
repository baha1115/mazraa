// models/SubscriptionConfig.js
const mongoose = require('mongoose');

const subscriptionConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'sub-plans' },
  monthDays:   { type: Number, default: 30 },
  yearDays:    { type: Number, default: 365 },
  basicLimit:  { type: Number, default: 1 },
  premiumLimit:{ type: Number, default: 2 },
  vipLimit:    { type: Number, default: 999 }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionConfig', subscriptionConfigSchema);
