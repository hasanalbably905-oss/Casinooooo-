const crypto = require('crypto');
const ProvablyFairGame = require('./models/ProvablyFairGame');

class ProvablyFairService {
    static generateServerSeed() {
        return crypto.randomBytes(32).toString('hex');
    }

    static hashServerSeed(serverSeed) {
        return crypto.createHash('sha256').update(serverSeed).digest('hex');
    }

    /**
     * @param {string} serverSeed
     * @param {string} clientSeed
     * @param {number} nonce
     * @param {number} max - أقصى قيمة (ستكون النتيجة بين 0 و max)
     * @param {number} cursor - مؤشر إضافي للعمليات المتعددة في نفس الجولة
     * @returns {number} رقم عشوائي موزع بين 0 و max
     */
    static generateRandom(serverSeed, clientSeed, nonce, max, cursor = 0) {
        const hmac = crypto.createHmac('sha256', Buffer.from(serverSeed));
        hmac.update(`${clientSeed}-${nonce}-${cursor}`);
        const hash = hmac.digest('hex');
        
        // استخدام أول 4 بايت (8 خانات hex)
        const part = hash.substring(0, 8);
        const decimal = parseInt(part, 16);
        // تحويل إلى النطاق المطلوب
        const result = Math.floor((decimal / 0x100000000) * (max + 1));
        return Math.min(result, max);
    }

    static async createGame(userId, clientSeed, gameType, gameId) {
        const serverSeed = this.generateServerSeed();
        const hash = this.hashServerSeed(serverSeed);
        const nonce = Math.floor(Date.now() / 1000);
        
        const game = new ProvablyFairGame({
            gameId,
            userId,
            serverSeed,
            clientSeed: clientSeed || crypto.randomBytes(16).toString('hex'),
            nonce,
            hash,
            gameType
        });
        await game.save();
        return { gameId, hash, clientSeed: game.clientSeed, nonce: game.nonce };
    }

    static async revealGame(gameId, result) {
        const game = await ProvablyFairGame.findOne({ gameId });
        if (!game) return null;
        game.revealed = true;
        game.revealedAt = new Date();
        game.result = result;
        await game.save();
        return game;
    }

    static async getRandomForGame(gameId, max, cursor = 0) {
        const game = await ProvablyFairGame.findOne({ gameId });
        if (!game) throw new Error('Provably Fair game not found');
        return this.generateRandom(game.serverSeed, game.clientSeed, game.nonce, max, cursor);
    }

    static verifyResult(serverSeed, clientSeed, nonce, expectedResult, max, cursor = 0) {
        const actual = this.generateRandom(serverSeed, clientSeed, nonce, max, cursor);
        return {
            isValid: actual === expectedResult,
            hash: this.hashServerSeed(serverSeed),
            actualResult: actual,
            expectedResult
        };
    }
}

module.exports = ProvablyFairService;