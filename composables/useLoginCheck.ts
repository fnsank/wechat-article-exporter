export default () => {
  const loginAccount = useLoginAccount();
  const modal = useModal();

  // TS 在 .ts 文件里默认不识别 *.vue 导入，但 Nuxt/Vite 运行时可以正确解析。
  // @ts-expect-error - vue file import in .ts is fine at runtime via Vite resolver
  const LoginModal = defineAsyncComponent(() => import('~/components/modal/Login.vue'));

  function checkLogin() {
    if (loginAccount.value !== null) return true;

    // 未登录微信时，直接打开扫码 Modal（Admin Key 由 dashboard 层守卫保证已保存；
    // Modal 内部再兜底判断，缺失才跳 /admin）
    modal.open(LoginModal);
    return false;
  }

  return {
    checkLogin,
  };
};
