// models/transaction.js
const mongoose = require('mongoose');

/**
 * Schema for tracking user transactions (withdrawals, challenges, transfers, games)
 * Used to prevent race conditions between different operations
 */
const TransactionSchema = new mongoose.Schema({
    // User who initiated the transaction
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    
    // Type of transaction
    type: { 
        type: String, 
        required: true, 
        enum: ['withdrawal', 'challenge', 'transfer', 'game'] 
    },
    
    // If it's a game, store the game ID for reference
    gameId: { 
        type: String, 
        default: null 
    },
    
    // For withdrawals, transfers, and bets
    amount: { 
        type: Number, 
        default: 0 
    },
    
    // Transaction status
    status: { 
        type: String, 
        required: true, 
        enum: ['pending', 'active', 'completed', 'cancelled', 'error'],
        default: 'pending'
    },
    
    // Additional data specific to the transaction type
    metadata: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    },
    
    // Timestamps
    startTime: { 
        type: Date, 
        default: Date.now 
    },
    
    // When transaction should auto-expire if not completed
    expiryTime: { 
        type: Date, 
        default: function() {
            return new Date(Date.now() + 2 * 60 * 1000); // 2 minutes default
        }
    },
    
    // When transaction was completed
    completionTime: { 
        type: Date, 
        default: null 
    }
}, {
    timestamps: true // adds createdAt and updatedAt
});

// Create indexes for fast querying
TransactionSchema.index({ userId: 1, status: 1 });
TransactionSchema.index({ expiryTime: 1, status: 1 });
TransactionSchema.index({ type: 1, status: 1 });

// Create the model
const Transaction = mongoose.model('Transaction', TransactionSchema);

module.exports = Transaction;