// generate-key.js
const crypto = require('crypto');

// Generate a random 256-bit (32-byte) key and encode as base64
const key = crypto.randomBytes(32).toString('base64');
console.log('Your encryption key:');
console.log(key);