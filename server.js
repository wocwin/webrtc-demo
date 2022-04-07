'use strict'

var http = require('http');

var express = require('express');

var serveIndex = require('serve-index');

var app = express();


app.use(serveIndex('./dist'));
app.use(express.static('./dist'));


var http_server = http.createServer(app);
http_server.listen(3003);

var io = require('socket.io')(http_server, {
  path: '/rtcket'
});
http_server.on('listening', onListening);
function onListening () {
  var addr = http_server.address();
  var bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  console.log('Listening on ' + bind);
}

let clients = []
io.on('connection', function (socket) {
  let query = socket.handshake.query
  let username = query.username
  let room = query.room
  console.log(username + '连接了')
  if (clients.some(v => v.userId === socket.id)) {
    return
  }
  socket.join(room)
  clients.push({ userId: socket.id, username })
  // 过滤相同用户名
  if (clients.length > 1) {
    let hash = {}
    clients = clients.reduce((item, next) => {
      hash[next.username] ? ''
        : hash[next.username] = true && item.push(next)
      return item
    }, [])
    console.log('最终', clients)
  }
  if (clients.length >= 2) {
    io.sockets.in(room).emit('ready')
  }
  socket.emit('joined')
  socket.broadcast.to(room).emit('join', { username })
  io.sockets.in(room).emit('clients', clients)
  // 收到对等连接创建的消息
  socket.on('pc message', function (data) {
    socket.to(data.to.userId).emit('pc message', data)
    console.log('pc message收到对等连接创建的消息')
  })
  // 发私信,发起视频互动的请求
  socket.on('interact', function (data) {
    socket.to(data.to.userId).emit('interact', data)
    console.log('interact发起视频互动的请求')
  })
  // 对方同意视频互动
  socket.on('agree interact', function (data) {
    socket.to(data.from.userId).emit('agree interact', data)
    console.log('agree interact对方同意视频互动')
  })
  // 对方拒绝视频互动
  socket.on('refuse interact', function (data) {
    socket.to(data.from.userId).emit('refuse interact', data)
    console.log('拒绝视频互动的请求')
  })
  // 对方停止视频互动
  socket.on('stop interact', function (data) {
    socket.to(data.to.userId).emit('stop interact', data)
    console.log('停止视频互动')
  })
  socket.on('leave', function () {
    socket.emit('left')
    socket.broadcast.to(room).emit('leave', { userId: socket.id, username })
    clients = clients.filter(v => v.userId !== socket.id)
    io.sockets.in(room).emit('clients', clients)
  })
  // 断开连接了
  socket.on('disconnect', function () {
    console.log(username + '断开连接了')
    const obj = clients.filter(v => v.userId === socket.id)
    socket.broadcast.to(room).emit('close_disconnect', obj)
    console.log(room + 'close_disconnect', obj)
    clients = clients.filter(v => v.userId !== socket.id)
    io.sockets.in(room).emit('clients', clients)
    console.log(username + '最终断开连接了')
  })
})
