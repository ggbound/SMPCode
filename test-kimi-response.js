const https = require('https');
const apiKey = 'sk-sp-d6705caa63684d65a2e7b841f38e172d';
const apiUrl = 'https://coding.dashscope.aliyuncs.com/v1/chat/completions';

const requestBody = JSON.stringify({
  model: 'kimi-k2.5',
  messages: [
    {
      role: 'system',
      content: 'You are a helpful assistant.'
    },
    {
      role: 'user',
      content: 'Hello, how are you?'
    }
  ],
  stream: true,
  temperature: 0.3,
  top_p: 0.9
});

const options = {
  hostname: 'coding.dashscope.aliyuncs.com',
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'Content-Length': requestBody.length
  }
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let buffer = '';
  
  res.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    console.log('=== Received Chunk ===');
    console.log(buffer);
    
    // 尝试解析 SSE 格式
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim().startsWith('data:')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          console.log('=== Stream Completed ===');
        } else {
          try {
            const parsed = JSON.parse(data);
            console.log('=== Parsed Data ===');
            console.log(JSON.stringify(parsed, null, 2));
          } catch (e) {
            console.error('=== Parse Error ===', e);
          }
        }
      }
    }
  });
  
  res.on('end', () => {
    console.log('=== Response End ===');
  });
});

req.on('error', (error) => {
  console.error('=== Error ===', error);
});

req.write(requestBody);
req.end();
