'use strict';

const RPS_BEATS = Object.freeze({
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
});

const XO_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]);

function rpsWinner(first, second, firstId, secondId) {
  if (!RPS_BEATS[first] || !RPS_BEATS[second]) throw new TypeError('Invalid rock-paper-scissors choice.');
  if (first === second) return null;
  return RPS_BEATS[first] === second ? firstId : secondId;
}
function xoWinner(board, mark) {
  if (!Array.isArray(board) || board.length !== 9 || !['X', 'O'].includes(mark)) return false;
  return XO_LINES.some(line => line.every(index => board[index] === mark));
}
function xoIsDraw(board) {
  return Array.isArray(board) && board.length === 9 && board.every(Boolean) && !xoWinner(board, 'X') && !xoWinner(board, 'O');
}

module.exports = { rpsWinner, xoWinner, xoIsDraw };
