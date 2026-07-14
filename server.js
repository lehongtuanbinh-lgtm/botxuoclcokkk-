const express = require('express');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('✅ THOR AI VIP PRO – ĐANG HOẠT ĐỘNG 24/7'));
app.get('/health', (req, res) => res.status(200).json({ 
  status: '✅ ONLINE', 
  version: 'VIP PRO 4.2 - SỬA LỖI ĐẶT CƯỢC',
  time: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}));

const server = http.createServer(app);
server.listen(PORT, () => console.log(`🌐 Giữ kết nối Render: Cổng ${PORT}`));

process.on('uncaughtException', (err) => console.error('❌ Lỗi toàn cục:', err));
process.on('unhandledRejection', (reason) => console.error('❌ Lỗi Promise:', reason));

require('./bot.js');