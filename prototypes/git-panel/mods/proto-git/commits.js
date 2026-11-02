// PROTOTYPE (wayfinder "Git panel prototype"): compact, read-only commit list
// of the current branch with a thin `git log --graph` lane column.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, settings } from "herdr";

export class Commits {
  init(root, cx) {
    this.getRoot = root; this.rows = []; this.root = null; this.n = 0;
    cx.timer.every(3000, (cx) => this.tick(cx));
  }

  tick(cx) {
    const root = this.getRoot();
    if (root !== this.root) { this.root = root; this.rows = []; this.n = 0; }
    if (this.n++ % 5 === 0) this.load(cx);
  }

  load(cx) {
    const root = this.root;
    if (!root || this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["--no-optional-locks", "log", "--graph", "-n", "40", "--format=%x1f%h%x1f%s%x1f%ar%x1f%D"], { cwd: root });
        if (root !== this.root || r.code !== 0) return;
        const rows = r.stdout.split("\n").filter(Boolean).map((l) => {
          const [g, h, s, a, d] = l.split("\x1f");
          return { g: g.replace(/\s+$/, ""), h, s, a: (a ?? "").replace(/ ago$/, ""), d };
        });
        if (JSON.stringify(rows) !== JSON.stringify(this.rows)) { this.rows = rows; cx.notify(); }
      } finally { this.loading = false; }
    });
  }

  summary() {
    const c = this.rows.filter((r) => r.h);
    return c.length ? `${c[0].h} ${c[0].s}` : "";
  }

  render(cx) {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const lane = Math.max(14, ...this.rows.map((r) => r.g.length * 7 + 6));
    if (!this.root) return div().p(12).text_size(12).text_color(t.dim).child("Not a git repository");
    return v_flex().id("commits-list").size_full().overflow_y_scrollbar().py(4).text_size(12)
      .children(this.rows.map((r, i) => h_flex().id(`c-${i}`).h(r.h ? 22 : 12).flex_none().px(10).gap(6).items_center()
        .when(Boolean(r.h), (el) => el.rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.onOpen?.(r.h)))
        .child(div().w(lane).flex_none().font_family(mono).text_size(11).text_color(t.accent).child(r.g))
        .when(Boolean(r.h), (el) => el
          .when(Boolean(r.d), (el) => el.child(div().flex_none().max_w(120).truncate().px(4).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(r.d.replace("HEAD -> ", ""))))
          .child(div().flex_1().min_w(0).truncate().child(r.s))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(r.a)))));
  }
}
