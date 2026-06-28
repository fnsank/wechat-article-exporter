export default () => {
  const loginAccount = useLoginAccount();

  function checkLogin() {
    if (loginAccount.value === null) {
      navigateTo('/admin');
      return false;
    }
    return true;
  }

  return {
    checkLogin,
  };
};
