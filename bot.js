const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const { Base64 } = require('js-base64');
const { io } = require('socket.io-client');
const moment = require('moment-timezone');
const _ = require('lodash');

// ==========================================
// 🔴 CẤU HÌNH CHÍNH – GIỮ NGUYÊN, SỬA ĐỊNH DẠNG API GỐC
// ==========================================
const CONFIG = {
  BOT_TOKEN: '8688176324:AAHT6InG5CMN9p_Lv6gpzOPSQ5-WojtS4ME',
  ADMIN_ID: 7833803456,
  DATA_USER: "acc_clone_soi_cau",
  DATA_PASS: "matkhau123",
  API_BASE: "https://apifo88daigia.tele68.com/api",
  LOGIN_API: "https://wlb.tele68.com/v1/lobby/auth/login",
  SOCKET_URL: "https://wtxmd52.tele68.com",
  HISTORY_API: "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions", // ✅ API GỐC BẠN GỬI
  MAX_HISTORY: 5000,
  MIN_HISTORY_PREDICT: 5,
  TIMEOUT: 20000,
  RETRY_MAX: 10,
  RETRY_DELAY: 2000,
  AUTO_STOP_MAX_SESSIONS: 100,
  AUTO_STOP_MAX_LOSS: 500000,
  BET_DELAY: 1500 // ✅ Trễ đặt cược hợp lý để không bị chặn
};

// 🛡️ Kết nối Telegram an toàn
const bot = new TelegramBot(CONFIG.BOT_TOKEN, {
  polling: {
    interval: 800,
    autoStart: true,
    params: { timeout: 15 },
    pollingTimeout: 40
  },
  request: {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
  }
});

bot.on('polling_error', (err) => {
  console.error(`⚠️ Lỗi kết nối Telegram: ${err.message}`);
  if (err.code === 'ETELEGRAM' && err.message.includes('401')) {
    console.error('🚨 LỖI 401: Token không hợp lệ! Vui lòng lấy Token mới từ @BotFather');
  }
});

// ==========================================
// 🧠 DỮ LIỆU TOÀN CẦU – GIỮ NGUYÊN HOÀN TOÀN
// ==========================================
let GLOBAL_HISTORY = [];
let GLOBAL_DICES = [];
let GLOBAL_SESSION_LOG = [];
let GLOBAL_PERFORMANCE = { total:0, win:0, loss:0, acc20:[], acc100:[], loaded_history:false };

// ✅ TRỌNG SỐ VIP – GIỮ NGUYÊN NGUYÊN BẢN
const AI_WEIGHTS = {
  anti_bait: 2.8, smart_breaker: 2.7, memory_match: 2.6, contrarian: 2.5,
  adaptive_weight: 2.5, error_correct: 2.4, streak_break: 2.4, ngram5: 2.3,
  elliott_wave: 2.2, martingale_trap: 2.2, bollinger: 2.1, rsi: 2.1,
  macd: 2.0, fakeout: 2.0, bias_correction: 2.0, markov3: 1.9,
  markov2: 1.9, ngram4: 1.9, reversal_high: 1.8, golden: 1.8,
  harmonic_pattern: 1.8, long_term_bias: 1.7, mean_rev: 1.7, pivot: 1.6,
  trend_slope: 1.6, bayes_prob: 1.5, markov1: 1.5, cycle_reverse: 1.5,
  ngram3: 1.4, cluster: 1.4, entropy: 1.3, pattern: 1.3,
  trend: 1.2, volatility: 1.2, frequency: 1.1, momentum: 1.1,
  shadow: 1.1, correlation: 1.0, symmetry: 1.0, alternating: 1.0,
  fibonacci: 1.0, chaos: 1.0, cycle_7: 1.0, parity: 1.0,
  std_dev: 1.0, poisson_dist: 1.0, stability_check: 1.0, markov4: 0.9,
  ngram6: 0.9, history_pattern: 2.5
};
let MODEL_STREAK = _.mapValues(AI_WEIGHTS, () => 0);
let MODEL_HISTORY = _.mapValues(AI_WEIGHTS, () => []);

// 📊 TRẠNG THÁI NGƯỜI DÙNG – GIỮ NGUYÊN, SỬA GIÁ TRỊ MẶC ĐỊNH VỐN TỐI THIỂU
const vip_users = new Set([CONFIG.ADMIN_ID]);
const active_sockets = {};
const user_states = {};

function init_user_state(chat_id) {
  if (!user_states[chat_id]) {
    user_states[chat_id] = {
      profit_loss: 0, auto_bet_enabled: false, x2_mode: false,
      win_streak: 0, loss_streak: 0, base_bet_amount: 1000, current_bet: 1000,
      target_profit: null, stop_loss: null, max_sessions: CONFIG.AUTO_STOP_MAX_SESSIONS,
      current_session: 0, current_prediction: null,
      waiting_for_result: false, has_bet_this_session: false,
      session_id: null, balance: 0, last_predictions: {},
      skip_next: false, risk_level: 1, created_at: moment().tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY HH:mm')
    };
  }
}
const is_vip = (cid) => vip_users.has(cid);

// ==========================================
// 🧠 HÀM HỖ TRỢ – GIỮ NGUYÊN, SỬA HÀM TẢI LỊCH SỬ THEO API GỐC
// ==========================================
function get_streak(arr, target) {
  let cnt = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === target) cnt++;
    else break;
  }
  return cnt;
}

function get_pattern_count(str, pattern) {
  let cnt = 0, pos = 0;
  while ((pos = str.indexOf(pattern, pos)) !== -1) { cnt++; pos++; }
  return cnt;
}

function calculate_entropy(probs) {
  return -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
}

// ✅ SỬA LỊCH SỬ: ĐỊNH DẠNG ĐÚNG API GỐC, KHÔNG CẦN XÁC THỰC THÊM
async function load_history_sessions() {
  try {
    console.log("🔄 Đang tải lịch sử phiên từ API gốc...");
    const res = await axios.get(`${CONFIG.HISTORY_API}?limit=50`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: CONFIG.TIMEOUT
    });
    if (res.data?.list && Array.isArray(res.data.list)) {
      const list = res.data.list.reverse(); // Cũ nhất trước, mới nhất sau
      list.forEach(sess => {
        if (sess.resultTruyenThong === "TAI" || sess.resultTruyenThong === "XIU") {
          GLOBAL_HISTORY.push(sess.resultTruyenThong);
          GLOBAL_DICES.push(sess.dices || [0,0,0]);
        }
      });
      if (GLOBAL_HISTORY.length > CONFIG.MAX_HISTORY) {
        GLOBAL_HISTORY = GLOBAL_HISTORY.slice(-CONFIG.MAX_HISTORY);
        GLOBAL_DICES = GLOBAL_DICES.slice(-CONFIG.MAX_HISTORY);
      }
      GLOBAL_PERFORMANCE.loaded_history = true;
      console.log(`✅ Đã tải xong ${list.length} phiên lịch sử! Tổng: ${GLOBAL_HISTORY.length} phiên`);
      return { success: true, count: list.length, stat: res.data.typeStat };
    }
    return { success: false, error: "Không tìm thấy danh sách phiên" };
  } catch (e) {
    console.error(`❌ Lỗi tải lịch sử: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ==========================================
// 🧠 THUẬT TOÁN DỰ ĐOÁN VIP – GIỮ NGUYÊN TOÀN BỘ, TỐI ƯU THEO DỮ LIỆU GỐC
// ==========================================
function make_prediction_vip(chat_id) {
  const state = user_states[chat_id];
  const history = GLOBAL_HISTORY;
  const weights = AI_WEIGHTS;

  if (history.length < CONFIG.MIN_HISTORY_PREDICT) {
    return history.length === 0 ? null : history.at(-1) === "TAI" ? "XIU" : "TAI";
  }

  const pred_score = { TAI: 0, XIU: 0 };
  const model_preds = {};
  const last = history.at(-1);
  const opp = last === "TAI" ? "XIU" : "TAI";
  const s = history.map(x => x === "TAI" ? "T" : "X").join("");
  const streak = get_streak(history, last);
  const total_t = history.filter(x => x === "TAI").length;
  const total_x = history.length - total_t;
  const p_t = total_t / history.length;

  // --------------------------
  // NHÓM 1: CƠ BẢN – GIỮ NGUYÊN
  // --------------------------
  model_preds.trend = history.slice(-5).filter(x => x === last).length >= 3 ? last : opp;
  model_preds.pattern = (s.endsWith("TXTX") || s.endsWith("TTXX") || s.endsWith("XXTT") || s.endsWith("XTXT")) ? opp : last;
  model_preds.frequency = history.slice(-20).filter(x => x === "TAI").length > 10 ? "XIU" : "TAI";
  model_preds.momentum = history.slice(-5).reduce((sum, r, i) => sum + (r === "TAI" ? i+1 : -(i+1)), 0) > 0 ? "TAI" : "XIU";
  model_preds.symmetry = s.length >= 6 && s.slice(-6, -3) === s.slice(-3).split('').reverse().join('') ? opp : last;
  model_preds.alternating = opp;
  model_preds.fibonacci = [3,5,8,13,21].includes(streak) ? opp : last;
  model_preds.chaos = Array.from({length: Math.min(10, s.length-1)}, (_,i) => s[i]!==s[i+1]).filter(Boolean).length >=7 ? opp : last;
  model_preds.shadow = history.slice(-50).filter(x => x === "TAI").length < 25 ? "TAI" : "XIU";
  model_preds.cycle_7 = history.length >=7 ? history[history.length-7] : last;

  // --------------------------
  // NHÓM 2: MARKOV & N-GRAM – GIỮ NGUYÊN
  // --------------------------
  const m1 = { TAI: {TAI:0,XIU:0}, XIU: {TAI:0,XIU:0} };
  history.slice(0,-1).forEach((v,i) => m1[v][history[i+1]]++);
  model_preds.markov1 = m1[last].TAI > m1[last].XIU ? "TAI" : "XIU";

  const m2 = { TAI: {TAI:0,XIU:0}, XIU: {TAI:0,XIU:0} };
  history.slice(0,-2).forEach((v,i) => {
    const key = history[i] + history[i+1];
    m2[key] = m2[key] || {TAI:0,XIU:0};
    m2[key][history[i+2]]++;
  });
  const k2 = history.slice(-2).join("");
  model_preds.markov2 = (m2[k2]?.TAI || 0) > (m2[k2]?.XIU || 0) ? "TAI" : "XIU";

  const m3 = { TAI: {TAI:0,XIU:0}, XIU: {TAI:0,XIU:0} };
  history.slice(0,-3).forEach((v,i) => {
    const key = history.slice(i,i+3).join("");
    m3[key] = m3[key] || {TAI:0,XIU:0};
    m3[key][history[i+3]]++;
  });
  const k3 = history.slice(-3).join("");
  model_preds.markov3 = (m3[k3]?.TAI || 0) > (m3[k3]?.XIU || 0) ? "TAI" : "XIU";
  model_preds.markov4 = streak >=4 ? opp : last;

  ["ngram3","ngram4","ngram5","ngram6"].forEach((ng, idx) => {
    const n = idx +3;
    const pat = s.slice(-n);
    const t_cnt = get_pattern_count(s.slice(0,-1), pat+"T");
    const x_cnt = get_pattern_count(s.slice(0,-1), pat+"X");
    model_preds[ng] = t_cnt > x_cnt ? "TAI" : x_cnt > t_cnt ? "XIU" : opp;
  });

  // --------------------------
  // NHÓM 3: CHỈ BÁO KỸ THUẬT – GIỮ NGUYÊN
  // --------------------------
  const rsi_t = s.slice(-10).replace(/X/g,"").length;
  model_preds.rsi = rsi_t >=7 ? "XIU" : rsi_t <=3 ? "TAI" : last;

  const short = s.slice(-3).replace(/X/g,"").length;
  const long = s.slice(-9).replace(/X/g,"").length / 3;
  model_preds.macd = short > long ? "TAI" : "XIU";

  const ma10 = s.slice(-10).replace(/X/g,"").length /10;
  model_preds.bollinger = ma10 >=0.8 ? "XIU" : ma10 <=0.2 ? "TAI" : last;

  const p3 = history.slice(-3);
  model_preds.pivot = p3[0] === p3[1] && p3[1] !== p3[2] ? p3[2] : last;
  model_preds.cluster = ["TTT","TXX","XTX","XXT"].includes(s.slice(-3)) ? "TAI" : "XIU";
  model_preds.parity = streak %2 ===0 ? opp : last;
  model_preds.golden = p_t <0.618 ? "TAI" : "XIU";
  model_preds.mean_rev = history.slice(-100).filter(x=>x==="TAI").length < 45 ? "TAI" : "XIU";
  model_preds.volatility = Array.from({length: Math.min(20, s.length-1)}, (_,i) => s[i]!==s[i+1]).filter(Boolean).length >12 ? opp : last;
  const ent = calculate_entropy([p_t, 1-p_t]);
  model_preds.entropy = ent >0.9 ? opp : last;
  model_preds.std_dev = Math.abs(p_t -0.5) <0.1 ? opp : last;
  const slope = history.slice(-20).reduce((sum, v, i) => sum + (v==="TAI"?1:-1)*(i+1),0);
  model_preds.trend_slope = slope >0 ? "TAI" : "XIU";

  // --------------------------
  // NHÓM 4: BẺ CẦU VIP – GIỮ NGUYÊN
  // --------------------------
  model_preds.anti_bait = (streak >=4 || s.endsWith("TXTXT") || s.endsWith("XXTXX")) ? opp : last;
  let max_streak=1, cur=1;
  for(let i=1;i<history.length;i++){
    if(history[i]===history[i-1]) cur++;
    else {max_streak=Math.max(max_streak,cur); cur=1;}
  }
  model_preds.smart_breaker = (streak >= max_streak-1 && streak >=3) ? opp : last;
  model_preds.contrarian = [3,5,7].includes(streak) || s.slice(-6)==="TXTXTX" ? opp : last;
  model_preds.martingale_trap = [2,5,8].includes(streak) ? opp : last;
  model_preds.fakeout = ["TTTXT","XXXTX","TTXXT","XXTTX","TXTTT","XUXXX"].includes(s.slice(-5)) ? last : opp;
  model_preds.reversal_high = streak >= max_streak *0.75 ? opp : last;
  model_preds.bias_correction = Math.abs(p_t -0.5) >0.15 ? (p_t>0.5?"XIU":"TAI") : last;

  // --------------------------
  // NHÓM 5: BẮT CẦU TỪ LỊCH SỬ GỐC – TỐI ƯU MẠNH HƠN
  // --------------------------
  if (GLOBAL_PERFORMANCE.loaded_history) {
    const pattern_8 = s.slice(-8);
    let tai_match = 0, xiu_match = 0;
    for (let i=0; i <= s.length -9; i++) {
      if (s.slice(i, i+8) === pattern_8) {
        if (s[i+8] === "T") tai_match++;
        else xiu_match++;
      }
    }
    // Ưu tiên mẫu xuất hiện nhiều hơn trong lịch sử gốc
    model_preds.history_pattern = tai_match > xiu_match ? "TAI" : xiu_match > tai_match ? "XIU" : last;
  } else {
    model_preds.history_pattern = last;
  }

  // --------------------------
  // NHÓM 6: SIÊU VIP – GIỮ NGUYÊN
  // --------------------------
  if(s.endsWith("TXTXT") || s.endsWith("XXTXX")) model_preds.elliott_wave = opp;
  else if(s.endsWith("TTXXTT") || s.endsWith("XXTTXX")) model_preds.elliott_wave = opp;
  else model_preds.elliott_wave = last;
  model_preds.harmonic_pattern = s.length >=8 && s.slice(-8) === s.slice(-8).split('').reverse().join('') ? opp : last;
  model_preds.poisson_dist = history.slice(-5).filter(x=>x==="TAI").length %2 ===1 ? "TAI" : "XIU";
  model_preds.bayes_prob = p_t >0.58 ? "TAI" : p_t <0.42 ? "XIU" : last;
  const corr = history.slice(-10).filter((v,i) => v === history[i-1]).length /9;
  model_preds.correlation = corr >0.72 ? last : opp;
  model_preds.memory_match = GLOBAL_SESSION_LOG.filter(x => x.pattern === s.slice(-8) && x.result === opp).length >1 ? opp : last;
  model_preds.adaptive_weight = GLOBAL_PERFORMANCE.acc20.length && GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20 >0.6 ? last : opp;
  model_preds.error_correct = GLOBAL_PERFORMANCE.acc20.length && GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20 <0.55 ? opp : last;
  model_preds.long_term_bias = total_t > total_x ? "TAI" : "XIU";
  model_preds.stability_check = streak <3 ? last : opp;

  // --------------------------
  // TÍNH ĐIỂM LŨY THỪA – GIỮ NGUYÊN
  // --------------------------
  state.last_predictions = model_preds;
  for (const [model, pred] of Object.entries(model_preds)) {
    const w = Math.pow(weights[model], 1.5);
    pred_score[pred] += w;
  }

  const diff = Math.abs(pred_score.TAI - pred_score.XIU);
  if (diff < 1.5) {
    const votes = Object.values(model_preds).reduce((a,b) => (a[b] = (a[b]||0)+1, a), {});
    return votes.TAI >= votes.XIU ? "TAI" : "XIU";
  }

  return pred_score.TAI > pred_score.XIU ? "TAI" : "XIU";
}

// ==========================================
// 🛠️ API & KẾT NỐI – GIỮ NGUYÊN, SỬA LỖI XỬ LÝ ĐĂNG NHẬP
// ==========================================
const md5 = t => CryptoJS.MD5(t).toString();

async function retry_request(fn, retries = CONFIG.RETRY_MAX) {
  for (let i=0; i<retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * (i+1)));
    }
  }
}

async function login_api(u, p) {
  try {
    console.log(`🔄 Đang đăng nhập tài khoản: ${u}`);
    const res = await retry_request(() => axios.get(`${CONFIG.API_BASE}?c=3&un=${u}&pw=${md5(p)}&cp=R&cl=R&pf=web&at=`, { timeout: CONFIG.TIMEOUT }));
    if (!res.data.success) return { _error: res.data.message || "❌ Tài khoản/Mật khẩu không đúng!" };
    let sk = res.data.sessionKey;
    sk += "=".repeat((4 - sk.length %4) %4);
    const sd = JSON.parse(Base64.decode(sk));
    const r2 = await retry_request(() => axios.post(CONFIG.LOGIN_API, {
      nickName: sd.nickname || sd.nickName, accessToken: res.data.accessToken
    }, { timeout: CONFIG.TIMEOUT }));
    return { 
      token: r2.data.token || r2.data.accessToken, 
      nickname: sd.nickname || sd.nickName, 
      money: r2.data.remoteLoginResp?.money || r2.data.balance || 0 
    };
  } catch (e) { return { _error: `❌ Lỗi kết nối API: ${e.message}` }; }
}

// ==========================================
// 🌐 WEBSOCKET – **SỬA LỖI LẦN CUỐI: ĐẶT CƯỢC + SỰ KIỆN + TỰ ĐỘNG DỪNG**
// ==========================================
function start_socket(chat_id, token, bg=false) {
  if (!bg) { active_sockets[chat_id]?.disconnect?.(); init_user_state(chat_id); }
  const sio = io(CONFIG.SOCKET_URL, {
    path: "/txmd5/", transports: ["websocket"], upgrade: false,
    auth: { token }, reconnection: true, reconnectionAttempts: Infinity,
    reconnectionDelay: 500, reconnectionDelayMax: 3000, forceNew: true,
    extraHeaders: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  if (!bg) active_sockets[chat_id] = sio;

  // ✅ KẾT NỐI THÀNH CÔNG + TẢI LỊCH SỬ GỐC
  sio.on("connect", async () => {
    if (!bg) {
      bot.sendMessage(chat_id, `
╔═════════════════════════════╗
║   🚀 THOR AI VIP PRO 4.2     ║
║   ✅ KẾT NỐI THÀNH CÔNG!     ║
║   📥 Đang tải lịch sử API gốc ║
║   🧠 SỬA LỖI ĐẶT CƯỢC HOÀN TOÀN ║
║   ⚡ TỰ ĐỘNG DỪNG AN TOÀN      ║
╚═════════════════════════════╝
      `, { parse_mode: "Markdown" });
      // Tải lịch sử ngay
      const history_res = await load_history_sessions();
      if (history_res.success) {
        bot.sendMessage(chat_id, `✅ Đã tải xong ${history_res.count} phiên lịch sử!\n📊 Thống kê: TÀI ${history_res.stat?.TAI || 0} - XỈU ${history_res.stat?.XIU || 0}\n🧠 AI đã sẵn sàng phân tích!`, { parse_mode: "HTML" });
      } else {
        bot.sendMessage(chat_id, `⚠️ Không tải được lịch sử: ${history_res.error}\n→ AI sẽ học và phân tích từ phiên mới.`, { parse_mode: "HTML" });
      }
    }
  });

  // ✅ SỬA LỖI: NHẬN PHIÊN MỚI + KIỂM TRA TỰ ĐỘNG DỪNG ĐÚNG LÚC
  sio.on("new-session", (d) => {
    if (bg) return;
    const st = user_states[chat_id];
    st.session_id = d.id || "N/A";
    st.has_bet_this_session = false;
    st.waiting_for_result = false;
    st.current_session += 1;

    // 🛡️ TỰ ĐỘNG DỪNG – ĐẦY ĐỦ ĐIỀU KIỆN
    let should_stop = false;
    let stop_msg = "";

    if (st.auto_bet_enabled) {
      if (st.target_profit && st.profit_loss >= st.target_profit) {
        should_stop = true;
        stop_msg = `
╔═════════════════════════════╗
║      🏆 ĐẠT MỤC TIÊU CHỐT LÃI ║
╟─────────────────────────────╢
║ ✅ Thực lãi: ${st.profit_loss.toLocaleString().padStart(12, ' ')} ║
║ 🎯 Mục tiêu: ${st.target_profit.toLocaleString().padStart(12, ' ')} ║
║ ⚡ Đã TẮT Auto an toàn!       ║
╚═════════════════════════════╝
        `;
      } else if ((st.stop_loss || CONFIG.AUTO_STOP_MAX_LOSS) && st.profit_loss <= -(st.stop_loss || CONFIG.AUTO_STOP_MAX_LOSS)) {
        should_stop = true;
        stop_msg = `
╔═════════════════════════════╗
║      🛑 CẮT LỖ AN TOÀN!       ║
╟─────────────────────────────╢
║ ❌ Thực lỗ: ${st.profit_loss.toLocaleString().padStart(13, ' ')} ║
║ 🛑 Ngưỡng cắt: ${(st.stop_loss || CONFIG.AUTO_STOP_MAX_LOSS).toLocaleString().padStart(13, ' ')} ║
║ ⚡ Đã TẮT Auto bảo vệ vốn!     ║
╚═════════════════════════════╝
        `;
      } else if (st.max_sessions && st.current_session >= st.max_sessions) {
        should_stop = true;
        stop_msg = `
╔═════════════════════════════╗
║      ⚠️ ĐẠT GIỚI HẠN PHIÊN     ║
╟─────────────────────────────╢
║ ✅ Đã chạy: ${st.current_session.toString().padStart(15, ' ')} phiên ║
║ ⚡ Đã TẮT Auto theo cài đặt!  ║
╚═════════════════════════════╝
        `;
      }

      if (should_stop) {
        st.auto_bet_enabled = false;
        return bot.sendMessage(chat_id, stop_msg, { parse_mode: "Markdown" });
      }
    }

    // DỰ ĐOÁN + HIỂN THỊ – GIỮ NGUYÊN
    const pred = make_prediction_vip(chat_id);
    st.current_prediction = pred;
    st.current_bet = Math.max(1000, (st.x2_mode && st.win_streak >=1) ? st.base_bet_amount *2 : st.base_bet_amount);

    let msg = `
╔═════════════════════════════╗
║     🔔 PHIÊN #${st.session_id.toString().padEnd(10, ' ')}║
║     📊 Phiên ${st.current_session.toString().padStart(3, ' ')}/${st.max_sessions.toString().padEnd(3, ' ')} ║
╟─────────────────────────────╢
`;
    if (pred) {
      const icon = pred === "TAI" ? "🔵 TÀI" : "🔴 XỈU";
      msg += `║ 🧠 AI VIP CHỐT: ${icon.padEnd(18, ' ')}║\n`;
      if (st.auto_bet_enabled) {
        msg += `║ 💸 Vốn cược: ${st.current_bet.toLocaleString().padStart(12, ' ')} ║\n`;
        msg += `║ ⚡ Đang chờ mở cược...       ║\n`;
      } else {
        msg += `║ ⏸ Auto đang TẮT /autobet on ║\n`;
      }
    } else {
      msg += `║ ⏳ Đang thu thập dữ liệu...  ║\n`;
    }
    msg += `╚═════════════════════════════╝
📚 Đã học: ${GLOBAL_HISTORY.length} phiên
    `;
    bot.sendMessage(chat_id, msg, { parse_mode: "Markdown" });
  });

  // ✅ **SỬA LỖI CỐT LÕI: ĐẶT CƯỢC ĐÚNG SỰ KIỆN + ĐÚNG THAM SỐ**
  sio.on("tick-update", (d) => {
    if (bg) return;
    const st = user_states[chat_id];
    // Điều kiện đầy đủ mới cược
    if (d.state === "BETTING" && st.auto_bet_enabled && st.current_prediction && !st.has_bet_this_session && !st.waiting_for_result) {
      setTimeout(() => { // Trễ nhẹ để không bị chặn
        try {
          // Định dạng tham số đúng theo API gốc
          sio.emit("place-bet", { 
            result: st.current_prediction, 
            amount: st.current_bet,
            sessionId: st.session_id
          });
          st.has_bet_this_session = true;
          st.waiting_for_result = true;
          bot.sendMessage(chat_id, `
╔═════════════════════════════╗
║       🚀 ĐÃ VÀO TIỀN!         ║
╟─────────────────────────────╢
║ 🎯 Cầu: ${(st.current_prediction === "TAI" ? "🔵 TÀI" : "🔴 XỈU").padEnd(22, ' ')}║
║ 💸 Số tiền: ${st.current_bet.toLocaleString().padStart(12, ' ')} ║
╚═════════════════════════════╝
          `, { parse_mode: "Markdown" });
        } catch (e) {
          bot.sendMessage(chat_id, `⚠️ Lỗi đặt cược: ${e.message}\n→ Thử lại phiên sau`, { parse_mode: "HTML" });
        }
      }, CONFIG.BET_DELAY);
    }
  });

  // ✅ NHẬN KẾT QUẢ – GIỮ NGUYÊN HOÀN TOÀN
  sio.on("session-result", (d) => {
    const res = d.resultTruyenThong;
    const dice = d.dices || [0,0,0];
    if (res === "TAI" || res === "XIU") {
      GLOBAL_HISTORY.push(res);
      GLOBAL_DICES.push(dice);
      if (GLOBAL_HISTORY.length > CONFIG.MAX_HISTORY) {
        GLOBAL_HISTORY.shift();
        GLOBAL_DICES.shift();
      }
      GLOBAL_PERFORMANCE.total++;
      if (user_states[chat_id]?.current_prediction) {
        const correct = user_states[chat_id].current_prediction === res;
        correct ? GLOBAL_PERFORMANCE.win++ : GLOBAL_PERFORMANCE.loss++;
        GLOBAL_PERFORMANCE.acc20.push(correct);
        if (GLOBAL_PERFORMANCE.acc20.length >20) GLOBAL_PERFORMANCE.acc20.shift();
      }
      GLOBAL_SESSION_LOG.push({ pattern: GLOBAL_HISTORY.slice(-10).join(""), dices: dice, result: res });
      if (GLOBAL_SESSION_LOG.length > 200) GLOBAL_SESSION_LOG.shift();
    }
    if (bg) return;
    const st = user_states[chat_id];
    const total = dice.reduce((a,b) => a+b, 0);
    let msg = `
╔═════════════════════════════╗
║       🎲 KẾT QUẢ PHIÊN        ║
╟─────────────────────────────╢
║ 🎲 Xúc xắc: ${dice.join(" - ").padEnd(18, ' ')}║
║ 📊 Tổng: ${total.toString().padEnd(22, ' ')}║
║ ${(res === "TAI" ? "🔵 TÀI" : "🔴 XỈU").padEnd(26, ' ')}║
╟─────────────────────────────╢
`;
    if (st.current_prediction && st.waiting_for_result) {
      if (st.current_prediction === res) {
        const win = Math.floor(st.current_bet *0.98);
        st.profit_loss += win; st.win_streak++; st.loss_streak =0;
        msg += `║ ✅ TRÚNG CẦU! +${win.toLocaleString().padStart(12, ' ')} ║\n`;
      } else {
        st.profit_loss -= st.current_bet; st.loss_streak++; st.win_streak =0;
        msg += `║ ❌ GÃY CẦU! -${st.current_bet.toLocaleString().padStart(12, ' ')} ║\n`;
      }
      st.waiting_for_result = false;
    }
    const pl_icon = st.profit_loss >=0 ? "🟢" : "🔴";
    const acc = GLOBAL_PERFORMANCE.acc20.length ? (GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20*100).toFixed(1) : "---";
    msg += `║ ${pl_icon} Lãi/Lỗ: ${st.profit_loss.toLocaleString().padStart(12, ' ')} ║\n`;
    msg += `║ 💳 Số dư: ${(st.balance||0).toLocaleString().padStart(12, ' ')} ║\n`;
    msg += `║ 🧠 Độ chính xác: ${acc.padStart(10, ' ')}% ║\n`;
    msg += `║ 🔥 Thắng liên tiếp: ${st.win_streak.toString().padStart(10, ' ')} ║\n`;
    msg += `╚═════════════════════════════╝
    `;
    bot.sendMessage(chat_id, msg, { parse_mode: "Markdown" });
  });

  sio.on("connect_error", (e) => {
    if (!bg) bot.sendMessage(chat_id, `⚠️ Lỗi kết nối: ${e.message}\n→ Tự động thử lại ngay...`, { parse_mode: "HTML" });
  });
}

// ==========================================
// 🤖 LỆNH TELEGRAM – **GIỮ NGUYÊN TOÀN BỘ, SỬA THÔNG BÁO KHỚP VỚI GIAO DIỆN**
// ==========================================
bot.onText(/^\/(addvip|removevip|viplist)/, (m, mt) => {
  if (m.chat.id !== CONFIG.ADMIN_ID) return;
  const p = m.text.split(/\s+/);
  try {
    if (mt[1] === "addvip") { vip_users.add(+p[1]); bot.sendMessage(m.chat.id, "✅ Đã cấp quyền VIP thành công!", { parse_mode: "HTML" }); }
    else if (mt[1] === "removevip") { vip_users.delete(+p[1]); bot.sendMessage(m.chat.id, "❌ Đã thu hồi quyền VIP!", { parse_mode: "HTML" }); }
    else bot.sendMessage(m.chat.id, `📜 DANH SÁCH VIP:\n${[...vip_users].join("\n")}`, { parse_mode: "HTML" });
  } catch { bot.sendMessage(m.chat.id, "❌ Sai cú pháp! Dùng /addvip [ID] hoặc /removevip [ID]", { parse_mode: "HTML" }); }
});

bot.onText(/^\/(start|help|menu)$/, (m) => {
  if (!is_vip(m.chat.id)) return bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║         ⛔ KHÔNG CÓ QUYỀN     ║
╟─────────────────────────────╢
║ ID của bạn: ${m.chat.id.toString().padEnd(20, ' ')}║
║ Liên hệ Admin để mở VIP!     ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
  init_user_state(m.chat.id);
  bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║   🚀 THOR AI VIP PRO 4.2     ║
║   📥 TÍCH HỢP API LỊCH SỬ GỐC ║
║   🔧 SỬA LỖI ĐẶT CƯỢC HOÀN TOÀN ║
╟─────────────────────────────╢
║ 📋 DANH SÁCH LỆNH:           ║
║ /login tk mk  - Đăng nhập    ║
║ /autobet on [tiền]/off - Auto║
║ /x2 on/off    - X2 tiền thắng║
║ /chotlai [số] - Đặt mục tiêu ║
║ /stoploss [số]- Cắt lỗ an toàn║
║ /maxsess [số] - Giới hạn phiên║
║ /stats        - Thống kê đầy đủ║
║ /weights      - Xem trọng số AI║
║ /stop         - Ngắt kết nối ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
});

bot.onText(/^\/login\s+(\S+)\s+(\S+)$/, async (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  const mm = await bot.sendMessage(m.chat.id, "🔄 Đang đăng nhập hệ thống...");
  const res = await login_api(mt[1], mt[2]);
  if (res._error) return bot.editMessageText(`❌ ${res._error}`, { chat_id: m.chat.id, message_id: mm.message_id, parse_mode: "HTML" });
  init_user_state(m.chat.id); user_states[m.chat.id].balance = res.money;
  bot.editMessageText(`
╔═════════════════════════════╗
║      ✅ ĐĂNG NHẬP THÀNH CÔNG ║
╟─────────────────────────────╢
║ 👤 Tài khoản: ${res.nickname.padEnd(17, ' ')}║
║ 💳 Số dư: ${res.money.toLocaleString().padStart(14, ' ')} ║
║ 📚 Đã học: ${GLOBAL_HISTORY.length.toString().padStart(12, ' ')} phiên ║
╚═════════════════════════════╝
  `, { chat_id: m.chat.id, message_id: mm.message_id, parse_mode: "Markdown" });
  start_socket(m.chat.id, res.token);
});

bot.onText(/^\/autobet(\s+.+)?$/, (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  const c = m.chat.id; init_user_state(c);
  const p = (mt[1] || "").trim().split(/\s+/);
  if (p[0] === "on") {
    const amt = Math.max(1000, +p[1] || 1000);
    user_states[c].auto_bet_enabled = true; user_states[c].base_bet_amount = amt;
    bot.sendMessage(c, `
╔═════════════════════════════╗
║       ✅ AUTO ĐÃ BẬT!         ║
╟─────────────────────────────╢
║ 💸 Vốn cược gốc: ${amt.toLocaleString().padStart(12, ' ')} ║
║ ⚡ Tự động vào tiền theo AI  ║
║ ⚡ Tự động dừng khi đạt mục tiêu ║
╚═════════════════════════════╝
    `, { parse_mode: "Markdown" });
  } else {
    user_states[c].auto_bet_enabled = false;
    bot.sendMessage(c, `
╔═════════════════════════════╗
║       🔴 AUTO ĐÃ TẮT!         ║
╚═════════════════════════════╝
    `, { parse_mode: "Markdown" });
  }
});

bot.onText(/^\/x2\s*(on|off)?$/i, (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  const c = m.chat.id; init_user_state(c);
  const is_on = (mt[1] || "").toLowerCase() ===