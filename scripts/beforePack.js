const { existsSync, rmSync, readdirSync, statSync } = require('fs');
const { join, dirname } = require('path');
const { execSync } = require('child_process');

// 递归删除目录
function removeDir(dirPath) {
  try {
    if (!existsSync(dirPath)) return;
    
    const files = readdirSync(dirPath);
    for (const file of files) {
      const filePath = join(dirPath, file);
      try {
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          removeDir(filePath);
        } else {
          rmSync(filePath, { force: true });
        }
      } catch (e) {
        // 忽略单个文件删除错误
      }
    }
    rmSync(dirPath, { force: true, recursive: true });
  } catch (e) {
    // 忽略目录删除错误
  }
}

// 延迟函数
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

exports.default = async function(context) {
  const { appOutDir } = context;
  const parentDir = dirname(appOutDir);
  
  console.log(`[BeforePack] Current output directory: ${appOutDir}`);
  
  // 清理其他旧的 dist 目录（dist2, dist3, dist4, dist5, dist6, dist7, dist8, dist9, release 等）
  try {
    if (existsSync(parentDir)) {
      const entries = readdirSync(parentDir);
      for (const entry of entries) {
        // 匹配 dist, dist2, dist3, ... distN, release 格式的目录
        if (/^(dist\d*|release)$/.test(entry)) {
          const oldDirPath = join(parentDir, entry);
          try {
            const stat = statSync(oldDirPath);
            if (stat.isDirectory()) {
              removeDir(oldDirPath);
              console.log(`[BeforePack] Cleaned up old directory: ${entry}`);
            }
          } catch (e) {
            // 忽略错误
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[BeforePack] Could not clean up old directories: ${e.message}`);
  }
  
  // 尝试使用 PowerShell 强制删除当前输出目录
  try {
    if (existsSync(appOutDir)) {
      console.log(`[BeforePack] Force removing directory using PowerShell...`);
      try {
        execSync(`powershell -Command "Remove-Item -Path '${appOutDir}' -Recurse -Force -ErrorAction SilentlyContinue"`, { 
          stdio: 'ignore',
          timeout: 30000
        });
        console.log(`[BeforePack] Cleaned up current output directory using PowerShell`);
      } catch (e) {
        // 如果 PowerShell 失败，使用 Node.js 方法
        removeDir(appOutDir);
        console.log(`[BeforePack] Cleaned up current output directory using Node.js`);
      }
    }
  } catch (e) {
    console.warn(`[BeforePack] Could not clean up current directory: ${e.message}`);
  }
  
  // 等待一段时间，让文件系统释放资源
  await delay(1000);
  
  console.log('[BeforePack] Cleanup complete');
};
