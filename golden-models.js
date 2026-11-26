'use strict';

// Central model registry replacing Golden's Mongoose model imports.
// All records live in one JSON file and are independent of Batoot wallet data.
const path = require('node:path');
const { createJsonDatabase } = require('./golden-json-db');

const database = createJsonDatabase({
  filePath: path.join(__dirname, 'data', 'golden-store.json'),
});

const names = [
  // Game models
  '2v2takribi', 'JackpotGame', 'MatchingGame', 'MatchingPlayer',
  'baccaratbot', 'blackjackbot', 'blackjackgame', 'blackjackgameusr',
  'bombchips', 'duel', 'game', 'matchbet', 'minegame', 'nrd',
  'nrdusergame', 'roulette', 'rps', 'takribi', 'takribihistory',
  'takribiusergame', 'tartibarqam', 'xogame',
  // Casino and server systems
  'Competition', 'ProvablyFairGame', 'Quest', 'StaffQuestProgress',
  'TicketClaim', 'Transaction', 'botola', 'botolaWhitelist',
  'databaseusers', 'dbinv', 'eventFounderBudget', 'link',
  'privatechannels', 's7b', 'setinv', 'team', 'withdrawSchema',
];

const models = Object.fromEntries(names.map(name => [name, database.model(name)]));

// Keep the original variable names used throughout the Golden source.
module.exports = {
  database,
  models,
  ...models,
  // The source imports rpsuser.js, while the extracted archive contains rpcuser.js.
  rpsuser: database.model('rpcuser'),
  // Common historical spelling aliases.
  blackjackusr: models.blackjackgameusr,
  nrdusr: models.nrdusergame,
  tkusr: models.takribiusergame,
  Team: models.team,
  Botola: models.botola,
  BotolaWhitelist: models.botolaWhitelist,
  Competition: models.Competition,
  InviteDatabase: models.dbinv,
  S7b: models.s7b,
  Link: models.link,
};
