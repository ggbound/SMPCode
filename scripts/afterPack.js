const { chmodSync, existsSync } = require('fs');
const { join } = require('path');

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName === 'darwin') {
    // Try both paths: with asar (unpacked) and without asar
    const possiblePaths = [
      // asar unpacked path (when asar is enabled)
      join(appOutDir, 'SMP Code.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64'),
      // legacy path (when asar is disabled)
      join(appOutDir, 'SMP Code.app', 'Contents', 'Resources', 'app', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64')
    ];
    
    let nodePtyDir = null;
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        nodePtyDir = path;
        console.log(`Found node-pty at: ${path}`);
        break;
      }
    }
    
    if (!nodePtyDir) {
      console.warn('Could not find node-pty directory in any expected location');
      return;
    }
    
    try {
      // Fix permissions for node-pty binaries
      const spawnHelperPath = join(nodePtyDir, 'spawn-helper');
      const ptyNodePath = join(nodePtyDir, 'pty.node');
      
      if (existsSync(spawnHelperPath)) {
        chmodSync(spawnHelperPath, 0o755);
        console.log(`Fixed permissions for spawn-helper at ${spawnHelperPath}`);
      } else {
        console.warn(`spawn-helper not found at ${spawnHelperPath}`);
      }
      
      if (existsSync(ptyNodePath)) {
        chmodSync(ptyNodePath, 0o755);
        console.log(`Fixed permissions for pty.node at ${ptyNodePath}`);
      } else {
        console.warn(`pty.node not found at ${ptyNodePath}`);
      }
      
      console.log('Fixed node-pty binary permissions successfully');
    } catch (e) {
      console.warn('Could not fix node-pty permissions:', e.message);
    }
  }
};
