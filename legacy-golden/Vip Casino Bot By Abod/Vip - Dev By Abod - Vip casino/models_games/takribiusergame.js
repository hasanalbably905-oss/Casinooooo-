const mongoose = require('mongoose');

const takribiUserSchema = new mongoose.Schema({
    id: { type: String, required: true, default: null },
    with: { type: String, required: true, default: null },
    msgID: { type: String, required: true, default: null },
    numbers: { type: Array, required: true, default: [] },
    result: { type: Number, required: true, default: 0 },
});

const tkuser = mongoose.model('tkuser', takribiUserSchema);

module.exports = tkuser;