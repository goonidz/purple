document.addEventListener("keydown", (e) => {
  if (e.key === "c" && !e.metaKey && !e.ctrlKey && e.target === document.body) {
    window.location.href = "/crm/compose";
  }
});
