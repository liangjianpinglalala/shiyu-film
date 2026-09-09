"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Sparkles,
  Play,
  Film,
  BookOpen,
  FolderOpen,
  Settings2,
  X,
  Check,
  Download,
  LogOut,
  ChevronRight,
  LoaderCircle,
  Smartphone,
  ShieldCheck,
  WandSparkles,
  Volume2,
  Captions,
  Clapperboard,
  ArrowUpRight,
  Trash2,
} from "lucide-react";

type Work = { id: string; title: string; kind: string; date: string };
const examples = [
  {
    title: "静夜思",
    author: "李白 · 唐",
    kind: "古诗",
    image: "/moon.svg",
    desc: "一缕月光，照见千年的思念。",
    time: "01:24",
  },
  {
    title: "守株待兔",
    author: "寓言故事 · 成语",
    kind: "成语",
    image: "/rabbit.svg",
    desc: "等待不会带来收获，行动才会。",
    time: "01:36",
  },
  {
    title: "望庐山瀑布",
    author: "李白 · 唐",
    kind: "古诗",
    image: "/landscape.svg",
    desc: "走进诗仙笔下的壮阔山河。",
    time: "01:48",
  },
];
const stages = [
  "检索与核实资料",
  "编写故事与分镜",
  "制作画面与配音",
  "对齐字幕与剪辑",
  "检查并导出成片",
];
export default function Home() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState("home"),
    [phone, setPhone] = useState(""),
    [user, setUser] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [count, setCount] = useState(0),
    [login, setLogin] = useState(false),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState("自动识别"),
    [advanced, setAdvanced] = useState(false),
    [ratio, setRatio] = useState("16:9 横屏"),
    [age, setAge] = useState("小学阶段"),
    [step, setStep] = useState(0),
    [running, setRunning] = useState(false),
    [works, setWorks] = useState<Work[]>([]),
    [selected, setSelected] = useState<Work | null>(null),
    [preview, setPreview] = useState(""),
    [scene, setScene] = useState(0),
    [playing, setPlaying] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setUser(sessionStorage.getItem("shiyu-user") || "");
    setReady(true);
  }, []);
  useEffect(() => {
    if (user) {
      try {
        setWorks(
          JSON.parse(localStorage.getItem("shiyu-works-" + user) || "[]"),
        );
      } catch {
        setWorks([]);
      }
    } else setWorks([]);
  }, [user]);
  useEffect(() => {
    if (count <= 0) return;
    const t = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(t);
  }, [count]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setScene((n) => (n + 1) % 4), 3000);
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setStep((n) => Math.min(n + 1, 5)), 1500);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (step !== 5 || !running) return;
    setRunning(false);
    const w = {
      id: crypto.randomUUID(),
      title: title.trim(),
      kind:
        kind === "自动识别"
          ? title.includes("兔") || title.includes("蛇")
            ? "成语"
            : "古诗"
          : kind,
      date: new Date().toLocaleDateString("zh-CN"),
    };
    setWorks((old) => {
      const next = [w, ...old];
      localStorage.setItem("shiyu-works-" + user, JSON.stringify(next));
      return next;
    });
    setSelected(w);
    setPage("detail");
  }, [step, running, title, kind, user]);
  function requireLogin(target: string) {
    const activeUser = user || sessionStorage.getItem("shiyu-user");
    if (activeUser && !user) setUser(activeUser);
    if (!activeUser) {
      setPending(target);
      setLogin(true);
      setError("");
      return;
    }
    setPage(target);
  }
  function start() {
    if (!title.trim()) {
      setNotice("请先输入古诗名或成语");
      return;
    }
    if (!user) {
      setPending("generate");
      setLogin(true);
      return;
    }
    setPage("progress");
    setStep(0);
    setRunning(true);
  }
  function verify() {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError("请输入有效的 11 位中国大陆手机号");
      return;
    }
    if (!sent || count === 0) {
      setError("请先获取有效的演示验证码");
      return;
    }
    if (code !== "123456") {
      setError("验证码不正确，演示验证码为 123456");
      return;
    }
    sessionStorage.setItem("shiyu-user", phone);
    setUser(phone);
    setLogin(false);
    setCode("");
    setSent(false);
    setCount(0);
    if (pending === "generate") {
      setPage("progress");
      setStep(0);
      setRunning(true);
    } else setPage(pending || "home");
  }
  function download() {
    const blob = new Blob(
      [
        `诗语映画 · 产品原型演示\n题目：${selected?.title}\n画面比例：${ratio}\n适合：${age}\n\n本文件为演示任务说明。尚未调用 AI 生成脚本、短信或 MP4。\n制作流程：资料核验 → 分镜 → 画面与配音 → 字幕剪辑 → 导出。`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected?.title}-演示说明.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const artwork =
    examples.find((e) => e.title === (selected?.title || preview)) ||
    examples[0];
  return (
    <div className="app" data-ready={ready}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="诗语映画首页">
          <span className="seal">诗</span>
          <span>
            诗语映画<small>SHIYU STUDIO</small>
          </span>
        </a>
        <div className="workspace-label">我的工作台</div>
        <nav>
          <button
            className={page === "home" ? "active" : ""}
            onClick={() => setPage("home")}
          >
            <Sparkles size={18} />
            灵感创作
            <span className="nav-dot" />
          </button>
          <button
            className={page === "works" ? "active" : ""}
            onClick={() => requireLogin("works")}
          >
            <FolderOpen size={18} />
            我的作品{user && <small>{works.length}</small>}
          </button>
          <button
            onClick={() => {
              setPage("home");
              setTimeout(
                () =>
                  document
                    .getElementById("inspiration")
                    ?.scrollIntoView({ behavior: "smooth" }),
                50,
              );
            }}
          >
            <BookOpen size={18} />
            灵感画廊
            <ArrowUpRight size={14} />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="note-card">
            <span>让传统文化，生动起来。</span>
            <p>
              每一首诗，都有一个世界。
              <br />
              每一个故事，都值得被看见。
            </p>
            <span className="mountain-mark">山 外 有 山 · 诗 中 有 画</span>
          </div>
          <div className="account">
            <span className="avatar">
              {user ? "诗" : <Smartphone size={19} />}
            </span>
            <div>
              <strong>
                {user
                  ? user.slice(0, 3) + "****" + user.slice(-4)
                  : "开启你的创作之旅"}
              </strong>
              <small>{user ? "原型体验账户" : "登录后保存你的作品"}</small>
            </div>
            <button
              aria-label={user ? "退出登录" : "登录"}
              onClick={() => {
                if (user) {
                  sessionStorage.removeItem("shiyu-user");
                  setUser("");
                  setPage("home");
                  setSelected(null);
                  setRunning(false);
                } else {
                  setPending("home");
                  setLogin(true);
                }
              }}
            >
              {user ? <LogOut size={17} /> : <ChevronRight size={17} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            工作台 <ChevronRight size={13} />{" "}
            <b>
              {page === "works"
                ? "我的作品"
                : page === "progress"
                  ? "动画制作"
                  : page === "detail"
                    ? "作品详情"
                    : "灵感创作"}
            </b>
          </span>
          <div>
            <span className="demo-badge">
              <i />
              交互原型 · 演示模式
            </span>
            <button
              className="header-login"
              onClick={() =>
                user
                  ? requireLogin("works")
                  : (setPending("home"), setLogin(true))
              }
            >
              {user ? "我的账户" : "登录 / 注册"}
              <ArrowUpRight size={14} />
            </button>
          </div>
          {user && (
            <button
              className="mobile-logout"
              aria-label="退出当前账户"
              onClick={() => {
                sessionStorage.removeItem("shiyu-user");
                setUser("");
                setPage("home");
                setSelected(null);
                setRunning(false);
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </header>
        <main>
          {page === "home" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span />
                    文字有意，画面有声
                  </div>
                  <h1>
                    让文字里的世界
                    <br />
                    <em>动起来。</em>
                  </h1>
                  <p>
                    一首古诗，一个成语，一部有温度的动画。
                    <br />
                    从灵感到成片，把创作交给 AI。
                  </p>
                  <div className="hero-meta">
                    <span>
                      <Check size={14} />
                      自动编导
                    </span>
                    <span>
                      <Check size={14} />
                      国风画面
                    </span>
                    <span>
                      <Check size={14} />
                      配音字幕
                    </span>
                  </div>
                </div>
                <div className="hero-art">
                  <img
                    src="/landscape.svg"
                    alt="青绿山峦、远舟与一轮明月的国风插画"
                  />
                  <div className="vertical-poem">
                    诗中有画
                    <br />
                    <span>画中有诗</span>
                  </div>
                  <div className="art-label">
                    <span className="tiny-seal">映画</span>一念起，山水生。
                  </div>
                </div>
              </section>
              <section className="creator">
                <div className="section-title">
                  <h2>
                    <WandSparkles size={21} />
                    今天，想让哪个故事动起来？
                  </h2>
                  <span>从一个名字开始</span>
                </div>
                <div className="tabs">
                  {["自动识别", "古诗", "成语"].map((k) => (
                    <button
                      key={k}
                      className={kind === k ? "chosen" : ""}
                      onClick={() => setKind(k)}
                    >
                      {k === "自动识别" && <Sparkles size={13} />} {k}
                    </button>
                  ))}
                </div>
                <div className="input-row">
                  <input
                    aria-label="古诗名或成语"
                    value={title}
                    maxLength={40}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && start()}
                    placeholder="输入古诗名或成语，如：静夜思、守株待兔"
                  />
                  <button className="primary" onClick={start}>
                    <Sparkles size={17} />
                    生成动画
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div className="suggestions">
                  <span>试试这些</span>
                  {["静夜思", "咏鹅", "守株待兔", "画蛇添足"].map((t) => (
                    <button key={t} onClick={() => setTitle(t)}>
                      {t}
                      <ArrowUpRight size={11} />
                    </button>
                  ))}
                </div>
                <div className="creator-footer">
                  <span>
                    <span className="green-dot" />
                    国风绘本 <i /> 普通话配音 <i /> {ratio} <i /> 约 1–2 分钟
                  </span>
                  <button
                    onClick={() => setAdvanced(!advanced)}
                    aria-expanded={advanced}
                  >
                    <Settings2 size={14} />
                    更多设置
                  </button>
                </div>
                {advanced && (
                  <div className="settings">
                    <label>
                      画面比例
                      <select
                        value={ratio}
                        onChange={(e) => setRatio(e.target.value)}
                      >
                        <option>16:9 横屏</option>
                        <option>9:16 竖屏</option>
                      </select>
                    </label>
                    <label>
                      适合年龄
                      <select
                        value={age}
                        onChange={(e) => setAge(e.target.value)}
                      >
                        <option>小学阶段</option>
                        <option>初中阶段</option>
                        <option>全年龄</option>
                      </select>
                    </label>
                    <p>原型保存设置；真实渲染将在后续接入。</p>
                  </div>
                )}
              </section>
              <section className="gallery" id="inspiration">
                <div className="section-title">
                  <div>
                    <h2>灵感，从这里开始</h2>
                    <p>看看文字如何变成画面，找到你的第一个故事。</p>
                  </div>
                  <span className="gallery-label">
                    精选示例 <span>03</span>
                  </span>
                </div>
                <div className="cards">
                  {examples.map((e, i) => (
                    <button
                      className="film-card"
                      key={e.title}
                      onClick={() => {
                        setPreview(e.title);
                        setScene(0);
                        setPlaying(true);
                      }}
                    >
                      <div className="card-art">
                        <img src={e.image} alt={e.title + "国风示例插画"} />
                        <span className="category">{e.kind}动画</span>
                        <span className="art-title">{e.title}</span>
                        <span className="play">
                          <Play size={19} fill="currentColor" />
                        </span>
                        <span className="duration">动态预览</span>
                      </div>
                      <div className="card-body">
                        <div>
                          <h3>{e.title}</h3>
                          <span>{e.author}</span>
                        </div>
                        <p>{e.desc}</p>
                        <div className="card-foot">
                          <span>国风绘本 · 示例分镜</span>
                          <ArrowUpRight size={15} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <section className="workflow">
                <div>
                  <span className="eyebrow">从文字到光影</span>
                  <h2>你只管想象，余下交给我们。</h2>
                </div>
                <div className="flow-steps">
                  {[
                    [BookOpen, "写故事"],
                    [Film, "绘画面"],
                    [Volume2, "配声音"],
                    [Clapperboard, "出成片"],
                  ].map(([Icon, label], i) => {
                    const C = Icon as typeof Film;
                    return (
                      <div key={String(label)}>
                        <span>0{i + 1}</span>
                        <C size={20} />
                        <strong>{String(label)}</strong>
                        {i < 3 && <ChevronRight size={13} />}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
          {page === "works" && (
            <section className="subpage">
              <div className="section-title">
                <div>
                  <span className="eyebrow">MY COLLECTION</span>
                  <h1>我的作品</h1>
                  <p>收藏每一次灵感，继续每一段故事。</p>
                </div>
                <button className="primary" onClick={() => setPage("home")}>
                  <Sparkles size={16} />
                  创作新动画
                </button>
              </div>
              {works.length === 0 ? (
                <div className="empty">
                  <FolderOpen size={42} />
                  <h2>你的第一部作品，即将诞生</h2>
                  <p>从一首喜欢的诗，或一个熟悉的成语开始。</p>
                  <button className="primary" onClick={() => setPage("home")}>
                    开始创作
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="cards">
                  {works.map((w) => (
                    <article className="film-card" key={w.id}>
                      <button
                        className="work-preview"
                        onClick={() => {
                          setSelected(w);
                          setPage("detail");
                        }}
                      >
                        <img
                          src={
                            (
                              examples.find((e) => e.title === w.title) ||
                              examples[0]
                            ).image
                          }
                          alt="演示封面"
                        />
                        <span>{w.title}</span>
                      </button>
                      <div className="card-body">
                        <h3>{w.title}</h3>
                        <p>
                          {w.date} · {w.kind} · 演示作品
                        </p>
                        <div className="card-foot">
                          <button
                            onClick={() => {
                              setSelected(w);
                              setPage("detail");
                            }}
                          >
                            查看作品 <ArrowRight size={14} />
                          </button>
                          <button
                            aria-label={"删除" + w.title}
                            onClick={() => {
                              const next = works.filter((x) => x.id !== w.id);
                              setWorks(next);
                              localStorage.setItem(
                                "shiyu-works-" + user,
                                JSON.stringify(next),
                              );
                              setNotice("演示作品已删除");
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {page === "progress" && (
            <section className="progress-page">
              <span className="eyebrow">A STORY IS TAKING SHAPE</span>
              <h1>「{title}」正在化作画面</h1>
              <p>这是模拟制作流程，无需额外操作。请保持当前页面打开。</p>
              <div className="progress-art">
                <img src="/landscape.svg" alt="制作中的国风画面" />
                <span>
                  <LoaderCircle className="spin" />
                  灵感正在发生
                </span>
              </div>
              <div className="progress-track">
                <span style={{ width: (step / 5) * 100 + "%" }} />
              </div>
              <ol>
                {stages.map((s, i) => (
                  <li key={s} className={i <= step ? "current" : ""}>
                    <span>
                      {i < step ? (
                        <Check size={16} />
                      ) : i === step ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {s}
                    <small>
                      {i < step ? "已完成" : i === step ? "演示中" : "等待中"}
                    </small>
                  </li>
                ))}
              </ol>
              <p className="muted">
                原型仅模拟状态流转，不调用模型、不收取费用。
              </p>
            </section>
          )}
          {page === "detail" && selected && (
            <section className="subpage">
              <button className="back" onClick={() => setPage("works")}>
                ← 返回我的作品
              </button>
              <div className="section-title">
                <div>
                  <span className="eyebrow">YOUR STORY</span>
                  <h1>{selected.title}</h1>
                  <p>{selected.kind} · 国风绘本 · 演示作品</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    setTitle(selected.title);
                    setPage("home");
                  }}
                >
                  再次创作
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="detail-grid">
                <button
                  className="result-art"
                  onClick={() => {
                    setPreview(selected.title);
                    setScene(0);
                    setPlaying(true);
                  }}
                >
                  <img src={artwork.image} alt="模板示例画面" />
                  <span className="play">
                    <Play fill="currentColor" />
                  </span>
                  <span className="result-label">播放模板动态预览</span>
                </button>
                <div className="detail-info">
                  <span className="demo-badge">原型演示结果</span>
                  <h2>故事的起点，已经准备好。</h2>
                  <p>
                    本次体验展示了从登录到制作完成的操作流程。当前画面为预置模板，并非根据题目生成的成片。
                  </p>
                  <button className="primary" onClick={download}>
                    <Download size={16} />
                    下载演示说明
                  </button>
                  <p className="muted">
                    MP4、真实配音、字幕与资料来源将在后续 AI 服务接入后提供。
                  </p>
                </div>
              </div>
            </section>
          )}
          <footer>
            <span>
              <span className="footer-seal">诗</span>诗语映画 · 让文化被看见
            </span>
            <span>
              用科技传递诗意 <i /> 产品原型 v0.1
            </span>
          </footer>
        </main>
      </div>
      {login && (
        <div className="overlay" onClick={() => setLogin(false)}>
          <section
            className="login-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="关闭登录"
              onClick={() => setLogin(false)}
            >
              <X size={20} />
            </button>
            <span className="seal">诗</span>
            <h2 id="login-title">让灵感，有处安放。</h2>
            <p>手机号验证登录，开启你的动画创作之旅。</p>
            <div className="demo-notice">
              原型体验：不发送真实短信，请使用测试手机号。
              <br />
              点击获取后，使用演示验证码 <b>123456</b>。
            </div>
            <label className="field-label" htmlFor="phone">
              手机号码
            </label>
            <div className="phone-field">
              <span>+86</span>
              <input
                id="phone"
                type="tel"
                autoComplete="tel-national"
                maxLength={11}
                placeholder="请输入 11 位手机号"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.replace(/\D/g, ""));
                  setSent(false);
                  setCount(0);
                  setCode("");
                }}
              />
            </div>
            <label className="field-label" htmlFor="code">
              短信验证码
            </label>
            <div className="code-field">
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="请输入验证码"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <button
                disabled={count > 0}
                onClick={() => {
                  if (!/^1[3-9]\d{9}$/.test(phone)) {
                    setError("请输入有效的 11 位中国大陆手机号");
                    return;
                  }
                  setSent(true);
                  setCount(60);
                  setError("");
                }}
              >
                {count > 0 ? `${count}s 后重新获取` : "获取验证码"}
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary login-submit" onClick={verify}>
              登录 / 注册
              <ArrowRight size={17} />
            </button>
            <p className="login-tip">
              <ShieldCheck size={14} />
              首次验证将自动创建演示账户
            </p>
            <p className="privacy-tip">
              仅在本机浏览器保存演示作品；生产登录与服务端权限尚未接入。
            </p>
          </section>
        </div>
      )}
      {preview && (
        <div
          className="overlay"
          onClick={() => {
            setPreview("");
            setPlaying(false);
          }}
        >
          <section
            className="preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="示例动态预览"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="关闭预览"
              onClick={() => {
                setPreview("");
                setPlaying(false);
              }}
            >
              <X />
            </button>
            <div className={"animated-scene scene-" + scene}>
              <img
                src={
                  (examples.find((e) => e.title === preview) || examples[0])
                    .image
                }
                alt="示例动画画面"
                style={{ animationPlayState: playing ? "running" : "paused" }}
              />
              <div className="scene-caption">
                <span>
                  {preview === "静夜思"
                    ? ["床前明月光", "疑是地上霜", "举头望明月", "低头思故乡"][
                        scene
                      ]
                    : preview === "守株待兔"
                      ? [
                          "田野里，住着一位农夫",
                          "一次偶然，让他放下了农具",
                          "他日复一日，守着树桩等待",
                          "收获来自行动，而不是侥幸",
                        ][scene]
                      : preview === "望庐山瀑布"
                        ? [
                            "日照香炉生紫烟",
                            "遥看瀑布挂前川",
                            "飞流直下三千尺",
                            "疑是银河落九天",
                          ][scene]
                        : [
                            "从一个题目开始",
                            "让想象化作画面",
                            "为故事赋予声音",
                            "让传统文化生动起来",
                          ][scene]}
                </span>
              </div>
            </div>
            <div className="preview-controls">
              <button onClick={() => setPlaying(!playing)}>
                {playing ? "暂停" : "播放"}
              </button>
              <div>
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    aria-label={"分镜" + (n + 1)}
                    className={scene === n ? "on" : ""}
                    onClick={() => setScene(n)}
                  />
                ))}
              </div>
              <span>{scene + 1} / 4</span>
            </div>
            <h3>
              {preview}
              <small>预置动态分镜 · 无配音 · 非生成视频</small>
            </h3>
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
