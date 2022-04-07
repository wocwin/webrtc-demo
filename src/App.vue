<template>
  <div id="app">
    <div class="info">
      <el-input
        v-model="username"
        placeholder="请输入用户名"
        style="margin-bottom: 15px"
      ></el-input>
      <el-button
        type="primary"
        @click="joinRoom"
        size="small"
        :disabled="socket && socket.connected"
        >加入聊天</el-button
      >
      <el-button
        type="primary"
        @click="leaveRoom"
        size="small"
        :disabled="!(socket && socket.connected)"
        >离开聊天</el-button
      >
    </div>
    <div id="chat" v-show="socket && socket.connected">
      <div>
        <div
          style="
            text-align: left;
            border-bottom: 1px dashed #ccc;
            padding: 0 0 10px 0;
          "
        >
          <span>用户数</span>
          <span style="color: #409eff">({{ onlineClients.length }})</span>
        </div>
        <ul class="clients-list">
          <li v-for="(item, index) in onlineClients" :key="index">
            <span>{{ item.username }}</span>
            <el-button
              v-if="item.username !== username"
              type="text"
              size="mini"
              @click="interact(item)"
              :disabled="getStatus(item)"
              >互动</el-button
            >
          </li>
        </ul>
      </div>
    </div>
    <div class="content">
      <div class="web-rtc">
        <div class="local">
          <h4>本地视频</h4>
          <video
            autoplay
            playsinline
            ref="localVideo"
            controls
            id="local-video"
          ></video>
        </div>
        <div class="remote">
          <div
            class="remote-info"
            v-for="(item, index) in biPeersList"
            :key="index"
          >
            <div class="btn">
              <el-button type="primary" @click="stopInteract(item, index)"
                >结束视频</el-button
              >
              <el-button type="primary" @click="takePicture(item)"
                >截图</el-button
              >
              <div style="margin-left: 15px">
                {{ item.other.username }}远程视频
              </div>
            </div>
            <video
              autoplay
              playsinline
              controls
              :ref="'remoteVideo' + item.other.userId"
              :id="'remoteVideo' + item.other.userId"
            ></video>
          </div>
        </div>
      </div>
      <div class="img-box" v-show="biPeersList.length > 0">
        <div style="margin-top: 10px">截图列表</div>
        <div ref="imgBox"></div>
      </div>
    </div>
  </div>
</template>

<script>
import io from 'socket.io-client'
export default {
  name: 'App',
  data () {
    return {
      pcConfig: {
        'iceServers': [
          {
            'url': 'stun:stun.l.google.com:19302'
          },
          {
            'url': 'turn:120.77.253.101:3478',
            'username': 'inter_user',
            'credential': 'power_turn'
          }
        ]
      },
      offerOptions: {
        offerToReceiveVideo: 1,
        offerToReceiveAudio: 1
      },
      biPeersList: [],
      peerList: Object.create(null),
      pcMsgTo: {},
      onlineClients: [],
      socket: null,
      localVideo: null,
      localStream: null,
      remoteStream: null,
      mediaStreamConstraints: {
        // video: { facingMode: { exact: 'environment' }, width: { ideal: 1080 }, height: { ideal: 1920 } }, // 开启手机后置摄像头
        video: true,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }
    }
  },
  computed: {
    username () {
      return this.getUrlKey('username') || `admin${Math.floor(Math.random() * 10 + 1)}`
    }
  },
  beforeDestroy () {
    this.socket.disconnect()
    this.onlineClients = []
  },
  mounted () {
    this.localVideo = this.$refs.localVideo
    console.log('参数', this.getUrlKey('username'))
    this.joinRoom()
  },
  methods: {
    // 获取url参数
    getUrlKey (name) {
      return decodeURIComponent(
        // eslint-disable-next-line no-sparse-arrays
        (new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.href) || [, ''])[1].replace(/\+/g, '%20')) || null
    },
    // 获取互动的状态
    getStatus (item) {
      return !!this.peerList[item.userId]
    },
    // 获取本地视频流
    startAction (callback) {
      navigator.mediaDevices.getUserMedia(this.mediaStreamConstraints).then((stream) => {
        this.gotLocalMediaStream(stream, callback)
        console.log('获取本地视频流')
      }).catch((err) => { console.log(err) })
    },
    // 赋值本地流到video标签播放
    gotLocalMediaStream (stream, callback) {
      this.localVideo = this.$refs.localVideo
      this.localVideo.srcObject = stream
      this.localStream = stream
      if (callback && typeof callback === 'function') {
        callback && callback()
      }
      console.log('赋值本地流')
    },
    // 获取远程视频流并播放
    handleRemoteMediaStreamAdded (pc, event) {
      pc.remoteStream = event.stream
      let remoteVideo = this.$refs['remoteVideo' + pc.other.userId][0]
      remoteVideo.srcObject = event.stream
      remoteVideo.addEventListener('loadedmetadata', () => {
        remoteVideo.play()
      })
      this.remoteStream = event.stream
      console.log(`从${pc.other.username}获取到远程视频`)
    },
    // 发送消息
    sendPcMessage (PcMessage) {
      let from = { userId: this.socket.id, username: this.username }
      let to = this.pcMsgTo
      this.socket.emit('pc message', { from, to, pcMsg: PcMessage })
    },
    // A和B建立连接，A和C建立连接，收到的B和C的消息需要进行区分
    signalingMessageCallback (message) {
      let otherId = message.from.userId // 对方的id
      let pc = this.peerList[otherId]
      message = message.pcMsg
      if (message.type === 'offer') {
        console.log('signalingMessageCallback offer', message)
        pc.setRemoteDescription(new RTCSessionDescription(message)).then(() => {
          pc.createAnswer()
            .then((description) => this.createdAnswerSuccess(pc, description))
            .catch((err) => { console.warn(err) })
        }).catch((err) => { console.warn(err) })
      } else if (message.type === 'answer') {
        console.log('收到了answer')
        console.log('pc', pc)
        pc.setRemoteDescription(new RTCSessionDescription(message), function () {
        }, (err) => { console.warn(err) })
      } else if (message.type === 'candidate') {
        let candidate = new RTCIceCandidate({
          sdpMLineIndex: message.label,
          candidate: message.candidate
        })
        pc.addIceCandidate(candidate).catch(err => {
          console.log('addIceCandidate-error', err)
        })
      }
    },
    //  创建answer,生成本地会话描述
    createdAnswerSuccess (pc, description) {
      pc.setLocalDescription(description).then(() => {
        this.sendPcMessage(pc.localDescription)
        console.log('创建answer,生成本地会话描述')
      }).catch((err) => { console.log(err) })
    },
    // 创建对等连接
    createPeerConnection (isCreatedOffer, data) {
      let other = isCreatedOffer ? data.to : data.from // 对方
      if (!this.peerList[other.userId]) {
        let pc = new RTCPeerConnection(this.pcConfig)
        pc.from = data.from
        pc.to = data.to
        pc.isSelf = isCreatedOffer // 是否是自己发起
        pc.other = isCreatedOffer ? data.to : data.from // 对方
        this.peerList[other.userId] = pc
        this.biPeersList.push(pc)
        this.createConnect(isCreatedOffer, pc)
      }
    },
    // icecandidate 通知，WebRTC 默认开启了 trickle-ice，所以每探测到一个 iceCandidate 都会触发一次该事件，直到事件返回为 null 时，表示完成 iceCandidate 探测
    createConnect (isCreatedOffer, pc) {
      pc.addEventListener('icecandidate', event => {
        console.log('icecandidate event:', event)
        if (event.candidate) {
          this.sendPcMessage({
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate
          })
        } else {
          console.log('candidates结束')
        }
      })
      if (this.localStream) {
        pc.addStream((this.localStream))
      } else {
        this.startAction(this.addStreamToLocalPc(pc))
      }
      pc.addEventListener('addstream', (event) => {
        console.log('addstream')
        this.handleRemoteMediaStreamAdded(pc, event)
      })
      // 创建offer,生成本地会话描述,如果是视频接收方，不需要生成offer
      if (isCreatedOffer) {
        pc.createOffer(this.offerOptions).then((description) => this.createdOfferSuccess(pc, description)).catch((err) => { console.log(err) })
      }
    },
    addStreamToLocalPc (pc) {
      return () => {
        pc.addStream((this.localStream))
      }
    },
    // 创建offer,生成本地会话描述
    createdOfferSuccess (pc, description) {
      // 用sd生成localPc的本地描述，remotePc的远程描述
      pc.setLocalDescription(description)
        .then(() => {
          this.sendPcMessage(pc.localDescription)
          console.log('创建offer,生成本地会话描述')
        }).catch((err) => { console.log(err) })
    },
    // 开始互动
    interact (user) {
      // 开启互动之前,需要先开启视频采集
      if (!this.localStream) {
        this.startAction(() => {
          this.socket.emit('interact', { from: { username: this.username, userId: this.socket.id }, to: user })
          console.log(`${this.username}向${user.username}发起了视频互动的请求`)
        })
      } else {
        this.socket.emit('interact', { from: { username: this.username, userId: this.socket.id }, to: user })
        console.log(`${this.username}向${user.username}发起了视频互动的请求`)
      }
    },
    // 离开
    leaveRoom () {
      this.socket.emit('leave')
    },
    // 加入
    joinRoom () {
      let url = 'http://localhost:3003/'
      if (process.env.NODE_ENV === 'development') {
        url = 'http://localhost:3003/'
      }
      if (this.onlineClients.some(v => v.username === this.username)) {
        this.$message('用户已经加入')
        return
      }
      this.socket = io.connect(url, { path: '/rtcket', query: { username: this.username, room: 'hello' } })
      // 其他用户加入聊天室
      this.socket.on('join', (data) => {
        console.log({ msg: data.username + '加入了聊天室', type: 'sys' })
      })
      // 自己加入成功
      this.socket.on('joined', () => {
        console.log('i joined th room')
      })
      // 自己离开了
      this.socket.on('left', () => {
        console.log('自己离开了')
        this.socket.disconnect()
        this.onlineClients = []
      })
      // 别人离开了
      this.socket.on('leave', data => {
        console.log({ msg: data.username + '离开了聊天室', type: 'sys' })
        if (this.biPeersList[data.userId]) {
          this.biPeersList[data.userId].close()
          delete this.biPeersList[data.userId]
        }
      })
      // 更新在线人数列表
      this.socket.on('clients', (data) => {
        console.log('clients', data)
        this.onlineClients = data
      })
      this.socket.on('pc message', (data) => {
        console.log('客户端收到了pc的消息', data)
        this.signalingMessageCallback(data)
      })
      // 收到别人的要求视频互动的私信
      this.socket.on('interact', data => {
        this.$confirm(`${data.from.username}想和你视频互动，请接受`, '提示信息', {
          distinguishCancelAndClose: true,
          confirmButtonText: '接受',
          cancelButtonText: '拒绝'
        })
          .then(() => {
            // 同意和对方互动, 对方发起，自己接受
            this.socket.emit('agree interact', data)
            this.pcMsgTo = data.from
            this.createPeerConnection(false, data)
          })
          .catch(() => {
            // 拒绝和对方互动
            this.socket.emit('refuse interact', data)
          })
      })
      // 对方同意了了和你视频互动，自己发起，对方接受
      this.socket.on('agree interact', data => {
        this.$message.success(`${data.to.username}接受了视频互动的请求`)
        this.pcMsgTo = data.to
        console.log(`${data.to.username}接受了视频互动的请求`)
        this.createPeerConnection(true, data)
      })
      // 对方拒绝了和你视频互动
      this.socket.on('refuse interact', data => {
        this.$message.warning(`${data.to.username}拒绝了视频互动的请求`)
        console.log(`${data.to.username}拒绝了视频互动的请求`)
        this.closeConnection()
      })
      // 监听到对方结束互动
      this.socket.on('stop interact', data => {
        let part = data.from
        this.$message.info(`${part.username}停止了和您互动，连接即将断开`)
        console.log('this.biPeersList', this.biPeersList)
        this.peerList[data.from.userId].close()
        this.peerList[data.from.userId] = null
        let index = this.biPeersList.findIndex(v => v.other.userId === part.userId)
        if (index > -1) {
          this.biPeersList[index].close()
          this.biPeersList.splice(index, 1)
        }
        this.closeConnection()
      })
      // 监听到对方断开disconnect
      this.socket.on('close_disconnect', (data) => {
        console.log('close_disconnect断开', data)
        if (data[0]) {
          this.$message.warning(`您停止了和${data[0].username}互动`)
        }
        this.closeConnection()
      })
    },
    // 结束互动
    stopInteract (item, index) {
      this.socket.emit('stop interact', { from: { username: this.username, userId: this.socket.id }, to: item.other })
      this.biPeersList.splice(index, 1)
      this.peerList[item.other.userId].close()
      this.peerList[item.other.userId] = null
    },
    // 拍照截图上传图片
    takePicture (item) {
      // 包装截图盒子
      let imgBox = this.$refs.imgBox
      // 哪个视频流上截图
      let video = this.$refs['remoteVideo' + item.other.userId][0]
      let canvas = document.createElement('canvas')
      canvas.width = video.videoWidth * 1
      canvas.height = video.videoHeight * 1
      canvas.getContext('2d')
        .drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.setAttribute('crossOrigin', 'Anonymous')
      let img = document.createElement("img")
      // const imgBase64 = canvas.toDataURL()
      img.src = canvas.toDataURL()
      imgBox.prepend(img)
      // console.log('获取base64', imgBase64)
      // 截图上传服务器
      // const res = await this.$api.remoteRate.getRemoteUploadImg({ orderNumber: this.$route.query.orderNumber, img: imgBase64 })
    },
    // 关闭连接
    async closeConnection () {
      this.socket.disconnect()
      this.onlineClients = []
      await this.closeLocalMedia()
      this.localStream = null
      this.remoteStream = null
    },
    // 关闭视频/音频流
    closeLocalMedia () {
      if (this.localStream && this.localStream.getTracks()) {
        this.localStream.getTracks().forEach((track) => {
          track.stop()
        })
      }
      if (this.remoteStream && this.remoteStream.getTracks()) {
        this.remoteStream.getTracks().forEach((track) => {
          track.stop()
        })
      }
      if (this.$refs.localVideo.srcObject && this.$refs.localVideo.srcObject.getTracks()) {
        this.$refs.localVideo.srcObject.getTracks().forEach((track) => {
          track.stop()
        })
      }
      if (this.biPeersList.other && this.$refs['remoteVideo' + this.biPeersList.other.userId][0].srcObject && this.$refs['remoteVideo' + this.biPeersList.other.userId][0].srcObject.getTracks()) {
        this.$refs['remoteVideo' + this.biPeersList.other.userId][0].srcObject.getTracks().forEach((track) => {
          track.stop()
        })
      }
      if (this.biPeersList.other) {
        this.$refs['remoteVideo' + this.biPeersList.other.userId][0].srcObject = null
      }
      this.$refs.localVideo.srcObject = null
      this.localStream = null
      this.remoteStream = null
    },
  }
}
</script>

<style lang="scss">
#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  padding: 40px;
  .info {
    width: 400px;
  }
  #chat {
    width: 400px;
    padding: 20px;
    margin-top: 20px;
    border: 1px solid #ccc;
    .clients-list {
      margin: 0;
      padding: 0;
      li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px dashed #ccc;
        padding: 10px 0;
      }
    }
  }
  .content {
    display: flex;
    .web-rtc {
      width: 440px;
      video {
        width: 100%;
      }
      .remote {
        .remote-info {
          .btn {
            display: flex;
            align-items: center;
            font-weight: bold;
          }
        }
      }
    }
    .img-box {
      margin-top: 50px;
      margin-left: 15px;
      box-shadow: 4px 4px 8px 4px rgb(0 0 0 / 15%);
      div:nth-of-type(2) {
        display: flex;
        flex-direction: column;
        padding: 20px;
        width: 400px;
        img {
          width: 100%;
          height: 100%;
          margin-top: 15px;
          &:first-child {
            margin-top: 0;
          }
        }
      }
    }
  }
}
</style>
