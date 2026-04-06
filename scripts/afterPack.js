const { chmodSync } = require('fs');
const { join } = require('path');

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName === 'darwin') {
    const nodePtyDir = join(appOutDir, 'SMP Code.app', 'Contents', 'Resources', 'app', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64');
    
    try {
      // Fix permissions for node-pty binaries
      chmodSync(join(nodePtyDir, 'spawn-helper'), 0o755);
      chmodSync(join(nodePtyDir, 'pty.node'), 0o755);
      console.log('Fixed node-pty binary permissions');
    } catch (e) {
      console.warn('Could not fix node-pty permissions:', e.message);
    }
  }
};
