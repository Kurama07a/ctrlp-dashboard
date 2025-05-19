const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SessionManager {
  constructor(app) {
    this.sessionFile = path.join(app.getPath('userData'), 'user-session.json');
    this.encryptionKey = this.generateMachineKey();
  }

  // Generate a machine-specific encryption key
  generateMachineKey() {
    const os = require('os');
    const machineInfo = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0].model,
    ].join('|');
    
    return crypto.createHash('sha256').update(machineInfo + 'CtrlP-Secret-Salt').digest('hex');
  }

  // Encrypt data before saving
  encrypt(data) {
    const algorithm = 'aes-256-cbc';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(this.encryptionKey.slice(0, 32)), iv);
    
    let encrypted = cipher.update(JSON.stringify(data));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted.toString('hex')
    };
  }

  // Decrypt data after reading
  decrypt(data) {
    const algorithm = 'aes-256-cbc';
    const iv = Buffer.from(data.iv, 'hex');
    const encryptedText = Buffer.from(data.encryptedData, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(this.encryptionKey.slice(0, 32)), iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return JSON.parse(decrypted.toString());
  }

  // Save user session
  saveSession(user) {
    try {
      const encrypted = this.encrypt(user);
      fs.writeFileSync(this.sessionFile, JSON.stringify(encrypted));
      return true;
    } catch (error) {
      console.error(`Error saving session: ${error.message}`);
      return false;
    }
  }

  // Load user session
  loadSession() {
    try {
      if (!fs.existsSync(this.sessionFile)) {
        return null;
      }
      
      const data = fs.readFileSync(this.sessionFile, 'utf8');
      if (!data || data.trim() === '') {
        console.error('Session file exists but is empty');
        this.clearSession();
        return null;
      }
      
      const encrypted = JSON.parse(data);
      if (!encrypted || !encrypted.iv || !encrypted.encryptedData) {
        console.error('Invalid session file format');
        this.clearSession();
        return null;
      }
      
      return this.decrypt(encrypted);
    } catch (error) {
      console.error(`Error loading session: ${error.message}`);
      this.clearSession();
      return null;
    }
  }

  // Clear user session
  clearSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        fs.unlinkSync(this.sessionFile);
      }
      return true;
    } catch (error) {
      console.error(`Error clearing session: ${error.message}`);
      return false;
    }
  }
}

module.exports = SessionManager;