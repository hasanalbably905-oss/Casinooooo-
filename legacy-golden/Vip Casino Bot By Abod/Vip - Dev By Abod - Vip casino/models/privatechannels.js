const mongoose = require('mongoose');

const privateChannelSchema = new mongoose.Schema({

  channelid: String,

  owner: String,

  expiredate: Date,

  announcemessageid: String,

  addedmembers: [String]

});

module.exports = mongoose.model('privdata', privateChannelSchema);