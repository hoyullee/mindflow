import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DRIVE_FILES,
  initialHomeState,
  type FolderModalState,
  type HomeState,
} from './types';
import {
  docKey,
  downloadFile,
  loadRecent,
  mapId,
  mapHref as buildMapHref,
  newMapHref as buildNewMapHref,
  parseOutline,
  readDocRaw,
  rootTextOf,
  safeFileName,
  saveRecent,
  sourceOf,
  syncDocsToCards,
} from './storage';

/**
 * React port of Home.dc.html's `class Component extends DCLogic`. Every exported
 * method below corresponds 1:1 to a method on the original controller; `patch()`
 * stands in for `this.setState`. `renderVals()`'s derived fields live in `viewModel.ts`.
 */
export function useHomeController() {
  const [state, setState] = useState<HomeState>(() => initialHomeState());
  const navigate = useNavigate();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const loaderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const spaceMenuAnchor = useRef<{ top: number; left: number } | null>(null);

  const patch = (partial: Partial<HomeState>) => setState((prev) => ({ ...prev, ...partial }));

  // ---- mount: restore recent list, pick up docs saved from the editor ----
  useEffect(() => {
    const onDocMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const closest = (sel: string) => !!(target && target.closest && target.closest(sel));
      setState((prev) => {
        let next = prev;
        if (prev.openMenu && !closest('.menu-btn,.menu-row')) next = { ...next, openMenu: null, moveFor: null, exportFor: null };
        if (prev.selectedCard && !closest('.map-card')) next = { ...next, selectedCard: null };
        if (prev.settingsOpen && !closest('.settings-pop,.settings-btn')) next = { ...next, settingsOpen: false };
        if (prev.spaceMenu && !closest('.space-dot,.menu-row,.space-row')) next = { ...next, spaceMenu: null };
        return next;
      });
    };
    window.addEventListener('mousedown', onDocMouseDown);

    const recent = loadRecent();
    if (recent.length) patch({ recent });

    setState((prev) => {
      const { spaces, changed } = syncDocsToCards(prev.spaces);
      return changed ? { ...prev, spaces } : prev;
    });

    return () => {
      window.removeEventListener('mousedown', onDocMouseDown);
      clearTimeout(loaderTimer.current);
    };
  }, []);

  // ---- drive (fake OAuth demo) ----
  const onDriveClick = () => patch({ activeSpace: 'drive', curFolder: null, driveFolder: null });
  const openDriveAuth = () => patch({ auth: 'choose' });
  const closeAuth = () => {
    if (state.auth !== 'connecting') patch({ auth: null });
  };
  const chooseAccount = () => {
    patch({ auth: 'connecting' });
    clearTimeout(loaderTimer.current);
    loaderTimer.current = setTimeout(() => patch({ drive: 'connected', auth: null }), 1400);
  };
  const disconnectDrive = () => patch({ drive: 'idle' });

  // ---- account / settings ----
  const toggleSettings = () => patch({ settingsOpen: !state.settingsOpen, nameEditing: false });
  const onNameInput = (v: string) => patch({ userName: (v || '').slice(0, 20) });
  const onNameBlur = () => {
    if (!state.userName.trim()) patch({ userName: 'mine' });
  };
  const startNameEdit = (e: MouseEvent) => {
    e.stopPropagation();
    patch({ nameEditing: true });
  };
  const onNameEditDone = () => {
    onNameBlur();
    patch({ nameEditing: false });
  };
  const logout = () => patch({ settingsOpen: false, confirmLogout: true });
  const cancelLogout = () => patch({ confirmLogout: false });
  const confirmLogoutYes = () => {
    patch({ confirmLogout: false, creatingMap: true, loaderMsg: '로그아웃하고 있어요' });
    clearTimeout(loaderTimer.current);
    loaderTimer.current = setTimeout(() => navigate('/login'), 900);
  };

  // ---- spaces ----
  const openNewSpace = () => patch({ newSpaceOpen: true, newSpaceName: '', newSpaceColor: '#f0663f' });
  const closeNewSpace = () => patch({ newSpaceOpen: false });
  const onNewSpaceName = (v: string) => patch({ newSpaceName: (v || '').slice(0, 10) });
  const createSpace = () => {
    const name = state.newSpaceName.trim();
    if (!name) return;
    const id = 's' + Date.now().toString(36);
    setState((prev) => ({
      ...prev,
      spaces: [...prev.spaces, { id, name, color: prev.newSpaceColor, maps: [] }],
      newSpaceOpen: false,
      newSpaceName: '',
    }));
  };
  const onNewSpaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') createSpace();
  };
  const pickSpaceColor = (c: string) => patch({ newSpaceColor: c });
  const setActiveSpace = (id: string) => patch({ activeSpace: id, curFolder: null, driveFolder: null });
  const toggleSpaceMenu = (id: string, anchor?: { top: number; left: number }) => {
    if (anchor) spaceMenuAnchor.current = anchor;
    patch({ spaceMenu: state.spaceMenu === id ? null : id });
  };
  const startRenameSpace = (id: string) => {
    const sp = state.spaces.find((s) => s.id === id);
    patch({ editingSpace: id, editingSpaceName: sp ? sp.name : '', spaceMenu: null });
  };
  const onRenameSpaceInput = (v: string) => patch({ editingSpaceName: (v || '').slice(0, 10) });
  const commitRenameSpace = () => {
    const id = state.editingSpace;
    if (!id) return;
    const name = state.editingSpaceName.trim();
    if (!name) {
      patch({ editingSpace: null });
      return;
    }
    setState((prev) => ({
      ...prev,
      spaces: prev.spaces.map((s) => (s.id === id ? { ...s, name } : s)),
      editingSpace: null,
    }));
  };
  const onRenameSpaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRenameSpace();
    } else if (e.key === 'Escape') {
      patch({ editingSpace: null });
    }
  };
  const askDeleteSpace = (id: string) => {
    const sp = state.spaces.find((s) => s.id === id);
    if (!sp || (Array.isArray(sp.maps) && sp.maps.some((m) => !state.deleted[m.title]))) return;
    if (state.spaces.length <= 1) return;
    patch({ confirmDeleteSpace: id, spaceMenu: null });
  };
  const cancelDeleteSpace = () => patch({ confirmDeleteSpace: null });
  const confirmDeleteSpaceYes = () => {
    const id = state.confirmDeleteSpace;
    if (!id) return;
    setState((prev) => {
      const spaces = prev.spaces.filter((s) => s.id !== id);
      if (!spaces.length) return prev;
      const first = spaces[0]!;
      const active = prev.activeSpace === id ? first.id : prev.activeSpace;
      return { ...prev, spaces, confirmDeleteSpace: null, activeSpace: active };
    });
  };

  // ---- favorites / trash / recent ----
  const toggleFav = (title: string) => {
    setState((prev) => {
      const favs = { ...prev.favs, [title]: !prev.favs[title] };
      if (!favs[title]) delete favs[title];
      return { ...prev, favs };
    });
  };
  const toggleFavList = () => patch({ favOpen: !state.favOpen });
  const toggleMenu = (title: string) => patch({ openMenu: state.openMenu === title ? null : title, moveFor: null, exportFor: null });
  const closeMenu = () => patch({ openMenu: null, moveFor: null, exportFor: null });
  const askDelete = (title: string) => patch({ confirmDelete: title, openMenu: null });
  const cancelDelete = () => patch({ confirmDelete: null });
  const confirmDeleteYes = () => {
    const title = state.confirmDelete;
    if (!title) return;
    setState((prev) => {
      const deleted = { ...prev.deleted, [title]: true };
      const favs = { ...prev.favs };
      delete favs[title];
      const src = sourceOf(title, DRIVE_FILES);
      const trash = prev.trash.some((t) => t.title === title) ? prev.trash : [...prev.trash, { title, source: src }];
      return { ...prev, deleted, favs, trash, confirmDelete: null };
    });
  };
  const deleteCard = (title: string) => {
    setState((prev) => {
      const deleted = { ...prev.deleted, [title]: true };
      const favs = { ...prev.favs };
      delete favs[title];
      return { ...prev, deleted, favs, openMenu: null };
    });
  };
  const toggleTrashList = () => patch({ trashOpen: !state.trashOpen });
  const toggleRecentList = () => patch({ recentOpen: !state.recentOpen });
  const askRestore = (title: string) => patch({ confirmRestore: title });
  const cancelRestore = () => patch({ confirmRestore: null });
  const confirmRestoreYes = () => {
    const title = state.confirmRestore;
    if (!title) return;
    setState((prev) => {
      const deleted = { ...prev.deleted };
      delete deleted[title];
      const trash = prev.trash.filter((t) => t.title !== title);
      const isDriveFile = DRIVE_FILES.some((f) => f.name === title);
      let spaces = prev.spaces;
      let toast = '';
      if (!isDriveFile && !spaces.some((s) => Array.isArray(s.maps) && s.maps.some((m) => m.title === title))) {
        const first = spaces[0];
        if (first) {
          spaces = spaces.map((s, i) => (i === 0 ? { ...s, maps: [...(s.maps || []), { title, when: '방금 복원됨', hue: '#f0663f' }] } : s));
          toast = `원래 공간이 삭제되어 "${first.name}" 공간으로 복원했어요`;
        }
      }
      return { ...prev, deleted, trash, spaces, confirmRestore: null, toast };
    });
  };
  const restoreCard = (title: string) => {
    setState((prev) => {
      const deleted = { ...prev.deleted };
      delete deleted[title];
      const trash = prev.trash.filter((t) => t.title !== title);
      return { ...prev, deleted, trash };
    });
  };
  const closeToast = () => patch({ toast: '', importDone: null, importError: null });

  const recordRecent = (title: string) => {
    setState((prev) => {
      const recent = [title, ...prev.recent.filter((t) => t !== title)].slice(0, 3);
      saveRecent(recent);
      return { ...prev, recent };
    });
  };

  // ---- open / create maps ----
  const mapHref = (title: string, docId?: string) => buildMapHref(title, docId);
  const newMapHref = () => buildNewMapHref();

  const navigateAfterLoader = (href: string, msg: string) => {
    patch({ creatingMap: true, loaderMsg: msg });
    clearTimeout(loaderTimer.current);
    loaderTimer.current = setTimeout(() => navigate(href), 900);
  };

  /** Home.dc.html `openWithLoader(e, title)` — records recent, shows the loader, then navigates. */
  const openWithLoader = (href: string, title: string) => {
    recordRecent(title);
    navigateAfterLoader(href, '맵을 불러오고 있어요');
  };

  /** Home.dc.html `onNewMapClick` (inline in `renderVals()`). */
  const onNewMapClick = (href: string) => navigateAfterLoader(href, '새 마인드맵을 준비하고 있어요');

  // ---- import / export ----
  const setImportRef = (el: HTMLInputElement | null) => {
    importInputRef.current = el;
  };
  const openImport = () => {
    const el = importInputRef.current;
    if (el) {
      el.value = '';
      el.click();
    }
  };
  const docRawForExport = (title: string, docId?: string): string | null => {
    if (docId) {
      const raw = readDocRaw(docId);
      if (raw) return raw;
    }
    return readDocRawByTitle(title);
  };
  function readDocRawByTitle(title: string): string | null {
    const direct = readDocRaw(mapId(title));
    if (direct) return direct;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('mindflow_doc_')) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        try {
          const d = JSON.parse(raw) as { nodes?: { root?: { text?: string } } };
          if ((d.nodes?.root?.text || '').trim() === title.trim()) return raw;
        } catch {
          /* ignore malformed doc */
        }
      }
    } catch {
      /* localStorage unavailable */
    }
    return null;
  }

  const exportMap = (title: string, docId?: string) => {
    patch({ openMenu: null, moveFor: null, exportFor: null });
    const raw = docRawForExport(title, docId);
    const safe = safeFileName(title);
    if (raw) {
      downloadFile(safe + '.json', raw);
      return;
    }
    downloadFile(
      safe + '.json',
      JSON.stringify(
        { v: 1, nodes: { root: { id: 'root', text: title, emoji: '🎯', parent: null, children: [], collapsed: false, color: null, x: 0, y: 0 } }, floats: [], lines: [], zones: [], layoutMode: 'radial', themeKey: 'coral' },
        null,
        2,
      ),
    );
  };

  const exportMapOutline = (title: string, docId?: string) => {
    patch({ openMenu: null, moveFor: null, exportFor: null });
    const raw = docRawForExport(title, docId);
    const safe = safeFileName(title);
    let d: { nodes?: Record<string, { text?: string; emoji?: string; note?: string; children?: string[]; free?: boolean }>; floats?: { text?: string }[] } | null = null;
    try {
      d = raw ? JSON.parse(raw) : null;
    } catch {
      d = null;
    }
    const out: string[] = [];
    if (d && d.nodes && d.nodes.root) {
      const nodes = d.nodes;
      const walk = (id: string, depth: number) => {
        const n = nodes[id];
        if (!n) return;
        const label = `${n.emoji ? n.emoji + ' ' : ''}${(n.text || '').replace(/\n/g, ' ')}`.trim();
        if (depth === 0) out.push('# ' + label);
        else out.push('  '.repeat(depth - 1) + '- ' + label);
        if (n.note && n.note.trim()) out.push('  '.repeat(Math.max(0, depth - 1)) + '  > ' + n.note.trim().replace(/\n/g, ' '));
        (n.children || []).forEach((cid) => walk(cid, depth + 1));
      };
      walk('root', 0);
      const frees = Object.keys(nodes).filter((k) => nodes[k]?.free);
      if (frees.length) {
        out.push('', '## 개별 주제');
        frees.forEach((k) => walk(k, 1));
      }
      const floats = d.floats || [];
      if (floats.some((f) => (f.text || '').trim())) {
        out.push('', '## 메모');
        floats.forEach((f) => {
          if ((f.text || '').trim()) out.push('- ' + f.text!.trim().replace(/\n/g, ' '));
        });
      }
    } else {
      out.push('# ' + title);
    }
    downloadFile(safe + '.md', out.join('\n'), 'text/markdown;charset=utf-8');
  };

  /** Home.dc.html `exportMapPNG` — rasterizes the card's already-rendered thumbnail SVG. */
  const exportMapPNG = (title: string) => {
    patch({ openMenu: null, moveFor: null, exportFor: null });
    let svgEl: SVGSVGElement | null = null;
    document.querySelectorAll('.map-card').forEach((card) => {
      if (!svgEl && card.getAttribute('data-title') === title) svgEl = card.querySelector('.map-thumb svg');
    });
    if (!svgEl) {
      patch({ importError: '미리보기가 없어 이미지를 만들 수 없어요. 맵을 한 번 열어 저장한 뒤 다시 시도해 주세요.' });
      return;
    }
    const clone = (svgEl as SVGSVGElement).cloneNode(true) as SVGSVGElement;
    const vb = (clone.getAttribute('viewBox') || '0 0 800 600').split(/\s+/).map(Number);
    const [vbX = 0, vbY = 0, vbW = 800, vbH = 600] = vb;
    const W = Math.max(1, Math.ceil(vbW));
    const H = Math.max(1, Math.ceil(vbH));
    clone.setAttribute('width', String(W));
    clone.setAttribute('height', String(H));
    clone.removeAttribute('style');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(vbX));
    bg.setAttribute('y', String(vbY));
    bg.setAttribute('width', String(vbW));
    bg.setAttribute('height', String(vbH));
    bg.setAttribute('fill', '#f5ece5');
    clone.insertBefore(bg, clone.firstChild);
    const str = new XMLSerializer().serializeToString(clone);
    const scale = Math.min(2.5, 6000 / Math.max(W, H));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(W * scale);
      cv.height = Math.round(H * scale);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeFileName(title) + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      type ImportedDoc = { nodes: Record<string, { text?: string; [k: string]: unknown }>; needsLayout?: boolean; [k: string]: unknown };
      let doc: ImportedDoc | null = null;
      let title = file.name.replace(/\.(json|md|markdown|txt)$/i, '');
      if (/\.json$/i.test(file.name)) {
        try {
          const d = JSON.parse(text) as { nodes?: { root?: { text?: string } } };
          if (d && d.nodes && d.nodes.root) {
            doc = d as ImportedDoc;
            title = (d.nodes.root.text || title).trim() || title;
          }
        } catch {
          /* not valid JSON */
        }
        if (!doc) {
          patch({ toast: '', importError: '올바른 MindFlow JSON 파일이 아니에요' });
          return;
        }
        doc.needsLayout = false;
      } else {
        const parsed = parseOutline(text, title);
        if (!parsed) {
          patch({ importError: '가져올 수 있는 개요 항목을 찾지 못했어요' });
          return;
        }
        doc = parsed as unknown as ImportedDoc;
        title = rootTextOf(parsed) || title;
      }
      if (!doc) return;
      const sp = state.spaces.find((s) => s.id === state.activeSpace) || state.spaces[0];
      const existing = new Set((sp?.maps || []).map((m) => m.title));
      let finalTitle = title;
      let i = 2;
      while (existing.has(finalTitle) || localStorage.getItem(docKey(mapId(finalTitle)))) {
        finalTitle = `${title} (${i++})`;
        if (i > 50) break;
      }
      if (finalTitle !== title && doc.nodes.root) doc.nodes.root.text = finalTitle;
      try {
        localStorage.setItem(docKey(mapId(finalTitle)), JSON.stringify(doc));
      } catch {
        /* storage unavailable */
      }
      setState((prev) => {
        const target = prev.spaces.find((s) => s.id === prev.activeSpace) || prev.spaces[0];
        if (!target) return prev;
        const spaces = prev.spaces.map((s) => (s.id === target.id ? { ...s, maps: [...(s.maps || []), { title: finalTitle, when: '방금 가져옴', hue: '#f0663f' }] } : s));
        return { ...prev, spaces, activeSpace: target.id, importDone: finalTitle };
      });
    };
    reader.readAsText(file);
  };
  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleImport(f);
  };

  // ---- folders ----
  const activeFolders = () => {
    const sp = state.spaces.find((s) => s.id === state.activeSpace);
    return sp && Array.isArray(sp.folders) ? sp.folders : [];
  };
  const mutateFolders = (spaces: HomeState['spaces'], fn: (folders: NonNullable<HomeState['spaces'][number]['folders']>) => NonNullable<HomeState['spaces'][number]['folders']>) =>
    spaces.map((s) => (s.id === state.activeSpace ? { ...s, folders: fn(Array.isArray(s.folders) ? s.folders : []) } : s));

  const openNewFolder = () => patch({ folderModal: { mode: 'new', id: null, name: '', drive: state.activeSpace === 'drive' } });
  const startRenameFolder = (id: string) => {
    const f = activeFolders().find((x) => x.id === id);
    patch({ folderModal: { mode: 'rename', id, name: f ? f.name : '' }, openMenu: null });
  };
  const closeFolderModal = () => patch({ folderModal: null });
  const isDriveFolderId = (id: string) => state.driveFolders.some((f) => f.id === id);
  const onFolderModalName = (v: string) => setState((prev) => (prev.folderModal ? { ...prev, folderModal: { ...prev.folderModal, name: v.slice(0, 10) } } : prev));
  const onFolderModalKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveFolderModal();
  };
  const saveFolderModal = () => {
    const fm = state.folderModal;
    if (!fm) return;
    const name = fm.name.trim().slice(0, 10);
    if (!name) return;
    const isDrive = fm.drive || (fm.id != null && isDriveFolderId(fm.id));
    if (fm.mode === 'new') {
      if (isDrive) {
        const id = 'df' + Date.now().toString(36);
        setState((prev) => ({ ...prev, driveFolders: [...prev.driveFolders, { id, name }], folderModal: null }));
      } else {
        const id = 'f' + Date.now().toString(36);
        setState((prev) => ({ ...prev, spaces: mutateFolders(prev.spaces, (fs) => [...fs, { id, name }]), folderModal: null }));
      }
    } else if (isDrive) {
      setState((prev) => ({ ...prev, driveFolders: prev.driveFolders.map((f) => (f.id === fm.id ? { ...f, name } : f)), folderModal: null }));
    } else {
      setState((prev) => ({ ...prev, spaces: mutateFolders(prev.spaces, (fs) => fs.map((f) => (f.id === fm.id ? { ...f, name } : f))), folderModal: null }));
    }
  };
  const startRenameDriveFolder = (id: string) => {
    const f = state.driveFolders.find((x) => x.id === id);
    patch({ folderModal: { mode: 'rename', id, name: f ? f.name : '', drive: true } as FolderModalState, openMenu: null });
  };
  const folderCount = (id: string) => {
    const mf = state.mapFolders;
    return Object.keys(mf).filter((t) => mf[t] === id && !state.deleted[t]).length;
  };
  const driveFolderCount = (id: string) => {
    const mf = state.driveMapFolders;
    return DRIVE_FILES.filter((f) => mf[f.name] === id && !state.deleted[f.name]).length;
  };
  const askDeleteFolder = (id: string) => {
    const isDrive = isDriveFolderId(id);
    const cnt = isDrive ? driveFolderCount(id) : folderCount(id);
    if (cnt > 0) return;
    patch({ confirmDeleteFolder: id, openMenu: null });
  };
  const cancelDeleteFolder = () => patch({ confirmDeleteFolder: null });
  const confirmDeleteFolderYes = () => {
    const id = state.confirmDeleteFolder;
    if (!id) return;
    if (isDriveFolderId(id)) {
      setState((prev) => {
        const driveMapFolders = { ...prev.driveMapFolders };
        for (const t in driveMapFolders) if (driveMapFolders[t] === id) delete driveMapFolders[t];
        return {
          ...prev,
          driveFolders: prev.driveFolders.filter((f) => f.id !== id),
          driveMapFolders,
          confirmDeleteFolder: null,
          driveFolder: prev.driveFolder === id ? null : prev.driveFolder,
        };
      });
      return;
    }
    setState((prev) => {
      const mapFolders = { ...prev.mapFolders };
      for (const t in mapFolders) if (mapFolders[t] === id) delete mapFolders[t];
      return {
        ...prev,
        spaces: mutateFolders(prev.spaces, (fs) => fs.filter((f) => f.id !== id)),
        mapFolders,
        confirmDeleteFolder: null,
        curFolder: prev.curFolder === id ? null : prev.curFolder,
      };
    });
  };
  const moveMapToFolder = (title: string, folderId: string | null) => {
    if (state.activeSpace === 'drive') {
      setState((prev) => {
        const driveMapFolders = { ...prev.driveMapFolders };
        if (folderId) driveMapFolders[title] = folderId;
        else delete driveMapFolders[title];
        return { ...prev, driveMapFolders, openMenu: null, moveFor: null };
      });
      return;
    }
    setState((prev) => {
      const mapFolders = { ...prev.mapFolders };
      if (folderId) mapFolders[title] = folderId;
      else delete mapFolders[title];
      return { ...prev, mapFolders, openMenu: null, moveFor: null };
    });
  };
  const backToSpace = () => patch({ curFolder: null, driveFolder: null, openMenu: null });
  const openFolder = (id: string) => patch({ curFolder: id, openMenu: null });
  const openDriveFolder = (id: string) => patch({ driveFolder: id, openMenu: null });

  // ---- drag & drop ----
  const setDraggingMap = (title: string | null) => patch({ draggingMap: title, openMenu: null, moveFor: null });
  const clearDrag = () => patch({ draggingMap: null, dragOverFolder: null });
  const setDragOverFolder = (id: string | null) => {
    if (state.dragOverFolder !== id) patch({ dragOverFolder: id });
  };

  // ---- selection / search ----
  const selectCard = (title: string | null) => patch({ selectedCard: title });
  const setExportFor = (title: string | null) => patch({ exportFor: title });
  const setMoveFor = (title: string | null) => patch({ moveFor: title });
  const setSearch = (v: string) => patch({ search: v });

  const setSpaceMenuAnchor = (anchor: { top: number; left: number }) => {
    spaceMenuAnchor.current = anchor;
  };

  return {
    state,
    importInputRef,
    spaceMenuAnchor,
    setImportRef,
    onDriveClick,
    openDriveAuth,
    closeAuth,
    chooseAccount,
    disconnectDrive,
    toggleSettings,
    onNameInput,
    onNameBlur,
    startNameEdit,
    onNameEditDone,
    logout,
    cancelLogout,
    confirmLogoutYes,
    openNewSpace,
    closeNewSpace,
    onNewSpaceName,
    onNewSpaceKey,
    createSpace,
    pickSpaceColor,
    setActiveSpace,
    toggleSpaceMenu,
    setSpaceMenuAnchor,
    startRenameSpace,
    onRenameSpaceInput,
    onRenameSpaceKey,
    commitRenameSpace,
    askDeleteSpace,
    cancelDeleteSpace,
    confirmDeleteSpaceYes,
    toggleFav,
    toggleFavList,
    toggleMenu,
    closeMenu,
    askDelete,
    cancelDelete,
    confirmDeleteYes,
    deleteCard,
    toggleTrashList,
    toggleRecentList,
    askRestore,
    cancelRestore,
    confirmRestoreYes,
    restoreCard,
    closeToast,
    recordRecent,
    mapHref,
    newMapHref,
    openWithLoader,
    onNewMapClick,
    openImport,
    onImportFile,
    exportMap,
    exportMapOutline,
    exportMapPNG,
    activeFolders,
    openNewFolder,
    startRenameFolder,
    startRenameDriveFolder,
    closeFolderModal,
    isDriveFolderId,
    onFolderModalName,
    onFolderModalKey,
    saveFolderModal,
    folderCount,
    driveFolderCount,
    askDeleteFolder,
    cancelDeleteFolder,
    confirmDeleteFolderYes,
    moveMapToFolder,
    backToSpace,
    openFolder,
    openDriveFolder,
    setDraggingMap,
    clearDrag,
    setDragOverFolder,
    selectCard,
    setExportFor,
    setMoveFor,
    setSearch,
  };
}

export type HomeController = ReturnType<typeof useHomeController>;
