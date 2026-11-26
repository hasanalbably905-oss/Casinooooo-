const mongoose = require('mongoose');

const TeamsSchema = new mongoose.Schema({
    teamtag: { type: String, required: true, default: null },
    ownerid: { type: String, required: true, default: null },
    admins: { type: Array, required: true, default: [] },
    players: { type: Array, required: true, default: [] }
});

const Team = mongoose.model('Team', TeamsSchema);

module.exports = Team;