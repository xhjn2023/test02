Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: '🏠', activeIcon: '🏠' },
      { pagePath: '/pages/work/work', text: '工作', icon: '💼', activeIcon: '💼', badge: 0 },
      { pagePath: '/pages/study/study', text: '学习', icon: '📚', activeIcon: '📚' },
      { pagePath: '/pages/life/life', text: '生活', icon: '🌱', activeIcon: '🌱' },
      { pagePath: '/pages/side/side', text: '副业', icon: '🚀', activeIcon: '🚀' },
      { pagePath: '/pages/review/review', text: '复盘', icon: '📝', activeIcon: '📝' }
    ]
  },
  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const url = this.data.list[index].pagePath;
      wx.switchTab({ url });
    },
    setSelected(index) {
      this.setData({ selected: index });
    }
  }
});
