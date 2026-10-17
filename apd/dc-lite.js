/* Minimal component renderer for the APD Bid & Project Hub demo. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = undefined;
    }
    setState(patch) {
      this.state = Object.assign({}, this.state || {}, patch);
      if (this.__render) this.__render();
    }
    forceUpdate() {
      if (this.__render) this.__render();
    }
  }
  window.DCLogic = DCLogic;

  const registry = {};
  let nextUid = 0;
  const WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    let v = scope;
    for (const part of path.split('.')) {
      if (v == null) return undefined;
      v = v[part];
    }
    return v;
  }

  function interp(str, scope) {
    return str.replace(/\{\{([^}]+)\}\}/g, (m, p) => {
      const v = lookup(p, scope);
      return v == null ? '' : String(v);
    });
  }

  function renderNodes(nodes, scope, ctx) {
    let out = '';
    for (const n of nodes) out += renderNode(n, scope, ctx);
    return out;
  }

  function renderNode(n, scope, ctx) {
    if (n.nodeType === 3) return esc(interp(n.nodeValue, scope));
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();

    if (tag === 'sc-for') {
      const m = WHOLE.exec(n.getAttribute('list') || '');
      const list = (m && lookup(m[1], scope)) || [];
      const as = n.getAttribute('as') || 'item';
      let out = '';
      list.forEach((item, i) => {
        const s = Object.create(scope);
        s[as] = item;
        s.$index = i;
        out += renderNodes(n.childNodes, s, ctx);
      });
      return out;
    }

    if (tag === 'sc-if') {
      const m = WHOLE.exec(n.getAttribute('value') || '');
      return m && lookup(m[1], scope) ? renderNodes(n.childNodes, scope, ctx) : '';
    }

    if (tag === 'dc-import') {
      const props = {};
      for (const a of n.attributes) {
        if (a.name === 'name' || a.name.startsWith('hint-')) continue;
        const key = a.name.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
        const m = WHOLE.exec(a.value);
        props[key] = m ? lookup(m[1], scope) : a.value;
      }
      const id = 'imp' + ctx.imp++;
      ctx.imports.push({ id, name: n.getAttribute('name'), props });
      return `<div data-dc-import="${id}"></div>`;
    }

    let attrs = '';
    let bound = false;
    let selectVal;
    let textValue;
    for (const a of n.attributes) {
      const name = a.name;
      if (name.startsWith('hint-')) continue;
      const m = WHOLE.exec(a.value);
      if (/^on[a-z]+$/.test(name) && m) {
        const fn = lookup(m[1], scope);
        if (typeof fn === 'function') {
          const hid = ctx.uid + '-' + ctx.h++;
          ctx.handlers[hid] = fn;
          attrs += ` data-on-${name.slice(2)}="${hid}"`;
        }
        continue;
      }
      let val = m ? lookup(m[1], scope) : interp(a.value, scope);
      if (name === 'value' && m) bound = true;
      if (tag === 'select' && name === 'value') { selectVal = val; continue; }
      if (tag === 'textarea' && name === 'value') { textValue = val; continue; }
      if (val === false || val == null) continue;
      if (val === true) val = '';
      attrs += ` ${name}="${esc(val)}"`;
    }
    if (bound) attrs += ' data-bound=""';
    if (tag === 'option' && ctx.selectVal !== undefined) {
      const optVal = n.getAttribute('value') != null ? n.getAttribute('value') : n.textContent;
      if (optVal === String(ctx.selectVal)) attrs += ' selected=""';
    }

    if (tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'input' || tag === 'meta' || tag === 'link') {
      return `<${tag}${attrs}>`;
    }
    let inner;
    if (tag === 'textarea') {
      inner = esc(textValue != null ? textValue : n.textContent);
    } else if (tag === 'select') {
      const prev = ctx.selectVal;
      ctx.selectVal = selectVal;
      inner = renderNodes(n.childNodes, scope, ctx);
      ctx.selectVal = prev;
    } else {
      inner = renderNodes(n.childNodes, scope, ctx);
    }
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  function delegate(root, comp) {
    const fire = (type, e) => {
      let el = e.target;
      while (el && el !== root.parentNode) {
        const hid = el.getAttribute && el.getAttribute('data-on-' + type);
        if (hid && hid.indexOf(comp.__uid + '-') === 0) {
          const fn = comp.__handlers[hid];
          if (fn) fn(e);
          return true;
        }
        if (el === root) break;
        el = el.parentElement;
      }
      return false;
    };
    root.addEventListener('click', (e) => fire('click', e));
    root.addEventListener('input', (e) => { if (!fire('input', e)) fire('change', e); });
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.tagName === 'TEXTAREA') return;
      if (t && t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio' && t.type !== 'file') return;
      fire('change', e);
    });
  }

  function mount(root, name, props) {
    const def = registry[name];
    const comp = new def.Cls(props || {});
    comp.__handlers = {};
    comp.__uid = 'c' + nextUid++;
    const tpl = document.getElementById(def.tplId);
    comp.__render = () => {
      const ctx = { uid: comp.__uid, h: 0, imp: 0, handlers: {}, imports: [] };
      const vals = comp.renderVals ? comp.renderVals() : {};
      const html = renderNodes(tpl.content.childNodes, vals, ctx);
      comp.__handlers = ctx.handlers;
      window.morphdom(root, `<div>${html}</div>`, {
        childrenOnly: true,
        onBeforeElUpdated(from, to) {
          if (from.hasAttribute && from.hasAttribute('data-dc-import') && from.__mounted) return false;
          const t = from.tagName;
          if ((t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') && !to.hasAttribute('data-bound')) {
            if (from.type === 'file') return false;
            if (from.type === 'checkbox' || from.type === 'radio') to.checked = from.checked;
            else to.value = from.value;
          }
          return true;
        }
      });
      for (const imp of ctx.imports) {
        const el = root.querySelector(`[data-dc-import="${imp.id}"]`);
        if (el && !el.__mounted) {
          el.__mounted = true;
          mount(el, imp.name, imp.props);
        }
      }
    };
    delegate(root, comp);
    comp.__render();
    if (comp.componentDidMount) comp.componentDidMount();
    return comp;
  }

  window.DC = {
    define(name, Cls, tplId) { registry[name] = { Cls, tplId }; },
    mount
  };
})();
