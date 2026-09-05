/**
 * app.js - 竞技图鉴与实时对战副驾主引导入口 (Bootstrap Entry Point)
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 初始化图鉴属性筛选徽章
  if (typeof initTypeFilterBadges === 'function') {
    initTypeFilterBadges();
  }

  // 2. 绑定图鉴界面与导航控件事件
  if (typeof bindControls === 'function') {
    bindControls();
  }

  // 3. 初始化无限滚动监听
  if (typeof initInfiniteScrollObserver === 'function') {
    initInfiniteScrollObserver();
  }

  // 4. 初始化对战副驾事件监听与输入控件
  if (typeof initCopilotControls === 'function') {
    initCopilotControls();
  }

  // 5. 载入宝可梦数据库并初始化渲染
  if (typeof loadDatabase === 'function') {
    await loadDatabase();
  }

  // 6. 异步检测本地 RapidOCR 后端服务状态并提示
  if (typeof checkOcrBackendStatus === 'function') {
    checkOcrBackendStatus();
  }
});
