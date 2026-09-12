import ts from 'typescript';

// Extract declarations, never execute application modules or callbacks.
export function extractWeb(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [], actions = [], diagnostics = [];
  const routers = new Set(['router', 'Router', 'navigation']);
  const literal = n => n && ts.isStringLiteralLike(n) ? n.text : null;
  const line = n => ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && /^(useRouter|useNavigation)$/.test(n.initializer.expression.getText(ast))) routers.add(n.name.text);
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
      const value = literal(n.moduleSpecifier); if (value !== null) imports.push(value);
    }
    if (ts.isCallExpression(n)) {
      const expr = n.expression.getText(ast);
      if (expr === 'require' || n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const value = literal(n.arguments[0]); if (value !== null) imports.push(value);
        else diagnostics.push({ kind: 'dynamic-import', line: line(n) });
      }
      const navigation = ts.isPropertyAccessExpression(n.expression) && routers.has(n.expression.expression.getText(ast)) && ['push', 'replace', 'navigate', 'back'].includes(n.expression.name.text);
      if (navigation || ['redirect', 'permanentRedirect'].includes(expr) || /^window\.location\.(assign|replace)$/.test(expr)) {
        actions.push({ line: line(n), action: 'navigate', target: literal(n.arguments[0]) });
      }
    }
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(ast);
      if (['href', 'to'].includes(name)) {
        const value = n.initializer && ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
        actions.push({ line: line(n), action: 'navigate', target: literal(value) });
      } else if (['onClick', 'onChange', 'onSubmit', 'onSelect'].includes(name)) actions.push({ line: line(n), action: name, target: null });
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  for (const d of ast.parseDiagnostics) diagnostics.push({ kind: 'parse-error', line: ast.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 });
  return { imports: [...new Set(imports)], actions, diagnostics, classes: [], declarations: [] };
}

// A bounded lexical adapter for Dart. Comments and strings are tokenized before
// recognizing navigation conventions; this is not a Dart type/flow analyzer.
export function dartTokens(source) {
  const tokens = []; let i = 0, line = 1;
  const advance = end => { for (; i < end; i++) if (source[i] === '\n') line++; };
  while (i < source.length) {
    if (/\s/.test(source[i])) { advance(i + 1); continue; }
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); advance(end < 0 ? source.length : end); continue; }
    if (source.startsWith('/*', i)) {
      let depth = 1; advance(i + 2);
      while (i < source.length && depth) { if (source.startsWith('/*', i)) { depth++; advance(i + 2); } else if (source.startsWith('*/', i)) { depth--; advance(i + 2); } else advance(i + 1); }
      continue;
    }
    const raw = source[i] === 'r' && /['"]/.test(source[i + 1] || '');
    if (raw || /['"]/.test(source[i])) {
      const startLine = line; if (raw) advance(i + 1);
      const quote = source.startsWith(source[i].repeat(3), i) ? source[i].repeat(3) : source[i]; advance(i + quote.length);
      let value = '', dynamic = false, closed = false;
      while (i < source.length) {
        if (source.startsWith(quote, i)) { advance(i + quote.length); closed = true; break; }
        if (!raw && source.startsWith('${', i)) {
          dynamic = true; advance(i + 2); let depth = 1;
          while (i < source.length && depth) {
            if (/['"]/.test(source[i])) {
              const inner = source.startsWith(source[i].repeat(3), i) ? source[i].repeat(3) : source[i]; advance(i + inner.length);
              while (i < source.length && !source.startsWith(inner, i)) { if (source[i] === '\\') advance(Math.min(i + 2, source.length)); else advance(i + 1); }
              if (source.startsWith(inner, i)) advance(i + inner.length);
            } else { if (source[i] === '{') depth++; else if (source[i] === '}') depth--; advance(i + 1); }
          }
          continue;
        }
        if (!raw && source[i] === '\\') { value += source.slice(i, i + 2); advance(Math.min(i + 2, source.length)); dynamic = true; continue; }
        if (!raw && source[i] === '$') dynamic = true;
        value += source[i]; advance(i + 1);
      }
      tokens.push({ value, kind: 'string', dynamic: dynamic || !closed, line: startLine }); continue;
    }
    const word = /^[a-zA-Z_$][\w$]*/.exec(source.slice(i));
    if (word) { tokens.push({ value: word[0], kind: 'word', line }); advance(i + word[0].length); }
    else { tokens.push({ value: source[i], kind: 'punctuation', line }); advance(i + 1); }
  }
  return tokens;
}

export function extractFlutter(file, source) {
  const tokens = dartTokens(source), imports = [], actions = [], declarations = [], classes = [], diagnostics = [];
  const v = i => tokens[i]?.value;
  // Delimiter matching handles nested builders and callback arguments.
  function end(start, open, close) { let depth = 0; for (let j = start; j < tokens.length; j++) { if (v(j) === open) depth++; if (v(j) === close && --depth === 0) return j; } return tokens.length - 1; }
  for (let i = 0; i < tokens.length; i++) {
    if (v(i) === 'class' && tokens[i + 1]?.kind === 'word') {
      let brace = i + 2; while (brace < tokens.length && v(brace) !== '{') brace++;
      const header = tokens.slice(i + 2, brace).map(t => t.value);
      classes.push({ name: v(i + 1), module: header.includes('Module'), widget: header.some(x => ['StatelessWidget', 'StatefulWidget', 'ConsumerWidget', 'HookWidget'].includes(x)), start: i, end: end(brace, '{', '}'), line: tokens[i].line });
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], owner = classes.find(c => i >= c.start && i <= c.end)?.name ?? null;
    if (['import', 'export', 'part'].includes(t.value) && tokens[i + 1]?.kind === 'string') imports.push(v(i + 1));
    if (['onPressed', 'onTap', 'onChanged', 'onSubmitted'].includes(t.value) && v(i + 1) === ':') actions.push({ line: t.line, action: t.value, target: null, owner });
    if (v(i + 1) !== '(') continue;
    const close = end(i + 1, '(', ')');
    const first = tokens[i + 2];
    const target = first?.kind === 'string' && !first.dynamic ? first.value : tokens.slice(i + 2, i + 5).map(t => t.value).join('') === 'Modular.initialRoute' ? '/' : null;
    const receiver = tokens.slice(Math.max(0, i - 12), i).map(t => t.value).join('');
    if (['pushNamed', 'pushReplacementNamed', 'navigate', 'popAndPushNamed', 'push', 'replace', 'go', 'goNamed'].includes(t.value) && /(?:Modular\.to\.|Navigator\.|Navigator\.of\(context\)\.|context\.|router\.)$/.test(receiver)) {
      // Navigator.pushNamed(context, '/path') puts the route second.
      const second = tokens[i + 3]?.value === ',' ? tokens[i + 4] : null;
      const destination = /Navigator\.$/.test(receiver) && second?.kind === 'string' && !second.dynamic ? second.value : target;
      actions.push({ line: t.line, action: 'navigate', target: destination, owner });
    }
    if ((['child', 'module'].includes(t.value) && v(i - 1) === '.' || ['ChildRoute', 'ModuleRoute'].includes(t.value)) && classes.some(c => c.name === owner && c.module)) {
      const body = tokens.slice(i + 3, close);
      const key = ['module', 'ModuleRoute'].includes(t.value) ? 'module' : 'child';
      const keyAt = body.findIndex((x, j) => x.value === key && body[j + 1]?.value === ':');
      const tail = body.slice(keyAt + 2);
      const constructor = tail.find((x, j) => /^[A-Z]/.test(x.value) && x.kind === 'word' && tail[j + 1]?.value === '(');
      declarations.push({ owner, kind: key, route: target, targetClass: constructor?.value ?? null, line: t.line, start: i, end: close });
    }
  }
  // Nested route constructors inherit their enclosing child route path.
  for (const d of [...declarations].sort((a, b) => a.start - b.start)) {
    const parent = declarations.filter(p => p.start < d.start && p.end > d.end).sort((a, b) => b.start - a.start)[0];
    if (parent) d.route = parent.route !== null && d.route !== null ? `${parent.route}/${d.route}`.replace(/\/+/g, '/') : null;
  }
  return { imports: [...new Set(imports)], actions, declarations: declarations.map(({ start, end, ...d }) => d), classes: classes.map(({ start, end, ...c }) => c), diagnostics };
}
