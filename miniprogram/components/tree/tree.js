const COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#fb923c'];

Component({
  properties: {
    node: { type: Object, value: {} },
    depth: { type: Number, value: 0 },
  },
  data: { expanded: true, dotColor: '#818cf8' },
  observers: {
    depth(d) { this.setData({ dotColor: COLORS[d % COLORS.length] }); },
  },
  methods: {
    toggle() { this.setData({ expanded: !this.data.expanded }); },
  },
});
