function escapeHTML(str) {
    return (str || '').replace(/[&<>"']/g, function(match) {
        const escape = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return escape[match];
    });
}

// 空欄時に使用する標準日時フォーマット生成
function getDefaultTitle() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${hh}:${mm}`;
}

// ステータスメッセージ表示関数
function showStatus(text) {
    if (!messageBox) return;
    messageBox.textContent = text;
    messageBox.style.opacity = '1';
    setTimeout(() => {
        messageBox.style.opacity = '0';
    }, 2000);
}

// ==========================================
// 1. 定数と状態管理
// ==========================================
const DB_NAME = 'FireflyNoteDB';
const DB_VERSION = 2;
const STORE_NAME = 'items';

let db;
let currentFolderId = 'root';
let pathStack = [{ id: 'root', title: 'Home' }];
let currentNoteId = null;
let itemToMoveId = null;
let saveTimer = null;

let undoStack = [];
let redoStack = [];
const MAX_STACK_SIZE = 50;

function checkIsTrash(item) {
    if (!item) return false;
    return item.isTrash === true || item.isTrash === 'true' || item.isTrash === 1;
}

// ==========================================
// 2. DOM要素の取得
// ==========================================
const mainView = document.getElementById('main-view');
const breadcrumbEl = document.getElementById('breadcrumb');
const btnBack = document.getElementById('btn-back');
const btnNew = document.getElementById('btn-new');
const btnMove = document.getElementById('btn-move');
const btnDelete = document.getElementById('btn-delete');
const btnUndo = document.getElementById('btn-undo');
const btnCopy = document.getElementById('btn-copy');
const btnClear = document.getElementById('btn-clear');
const btnClearHeader = document.getElementById('btn-clear-header');
const btnTitleClear = document.getElementById('btn-title-clear');

const searchInput = document.getElementById('search-input');
const btnSearchClear = document.getElementById('btn-search-clear');
const sortSelect = document.getElementById('sort-select');

const editorView = document.getElementById('editor-view');
const editorTitle = document.getElementById('editor-title');
const editorText = document.getElementById('editor');
const messageBox = document.getElementById('message');

const moveModal = document.getElementById('move-modal');
const moveModalTitle = document.getElementById('move-modal-title');
const moveList = document.getElementById('move-list');
const btnMoveCancel = document.getElementById('btn-move-cancel');

const newModal = document.getElementById('new-modal');
const btnNewFolder = document.getElementById('btn-new-folder');
const btnNewNote = document.getElementById('btn-new-note');
const btnNewCancel = document.getElementById('btn-new-cancel');

// ==========================================
// 3. 初期化 ＆ DB設定 ＆ 孤立データ一掃
// ==========================================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject("DBエラー");
        request.onsuccess = (e) => {
            db = e.target.result;
            sanitizeDatabase().then(() => resolve(db));
        };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            let store;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('parentId', 'parentId', { unique: false });
                store.createIndex('type', 'type', { unique: false });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
                store.createIndex('isTrash', 'isTrash', { unique: false });
            } else {
                store = e.target.transaction.objectStore(STORE_NAME);
                if (!store.indexNames.contains('isTrash')) {
                    store.createIndex('isTrash', 'isTrash', { unique: false });
                }
            }
        };
    });
}

function sanitizeDatabase() {
    return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
            const items = req.result || [];
            const itemMap = new Map();
            items.forEach(item => itemMap.set(item.id, item));

            items.forEach(item => {
                if (item.isTrash === undefined || item.isTrash === null) {
                    item.isTrash = false;
                    store.put(item);
                }
                if (item.parentId && item.parentId !== 'root' && item.parentId !== 'trash') {
                    if (!itemMap.has(item.parentId)) {
                        store.delete(item.id);
                    }
                }
            });
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

function createFireflies() {
    const count = 15;
    for (let i = 0; i < count; i++) {
        const firefly = document.createElement('div');
        firefly.className = 'firefly';

        const randomizeFirefly = (el) => {
            const startX = Math.random() * 100;
            const startY = Math.random() * 100;
            const moveX = (Math.random() - 0.5) * 300;
            const moveY = (Math.random() - 0.5) * 300;

            el.style.left = `${startX}vw`;
            el.style.top = `${startY}vh`;
            el.style.setProperty('--tx', `${moveX}px`);
            el.style.setProperty('--ty', `${moveY}px`);
        };

        randomizeFirefly(firefly);
        firefly.style.animationDelay = `${Math.random() * 8}s`;
        firefly.style.animationDuration = `${8 + Math.random() * 6}s`;

        firefly.addEventListener('animationiteration', () => {
            randomizeFirefly(firefly);
        });

        document.body.appendChild(firefly);
    }
}

function isFolderInTrash(folder, itemMap) {
    let current = folder;
    let visited = new Set();

    while (current) {
        if (checkIsTrash(current)) return true;
        if (current.parentId === 'root') return false;
        if (current.parentId === 'trash') return true;
        if (!current.parentId) return false;

        if (visited.has(current.parentId)) break;
        visited.add(current.parentId);

        if (!itemMap.has(current.parentId)) return true;
        current = itemMap.get(current.parentId);
    }
    return false;
}

function isDescendantOf(targetFolderId, moveItemId, itemMap) {
    let current = itemMap.get(targetFolderId);
    let visited = new Set();

    while (current) {
        if (current.id === moveItemId) return true;
        if (!current.parentId || current.parentId === 'root') break;
        if (visited.has(current.parentId)) break;

        visited.add(current.parentId);
        current = itemMap.get(current.parentId);
    }
    return false;
}

function getAllDescendantIds(parentId, allItems) {
    let result = [];
    const children = allItems.filter(item => item.parentId === parentId);
    children.forEach(child => {
        result.push(child.id);
        if (child.type === 'folder') {
            result = result.concat(getAllDescendantIds(child.id, allItems));
        }
    });
    return result;
}

// ==========================================
// 4. メインビュー ＆ 並び替え ＆ パンくず
// ==========================================
function loadItems() {
    if (!db) return;
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const allItems = request.result || [];
        let items = [];

        const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';

        if (btnSearchClear) {
            btnSearchClear.style.display = searchQuery !== '' ? 'block' : 'none';
        }

        if (currentFolderId === 'trash') {
            items = allItems.filter(item => checkIsTrash(item));
            if (searchQuery !== '') {
                items = items.filter(i => 
                    (i.title && i.title.toLowerCase().includes(searchQuery)) ||
                    (i.text && i.text.toLowerCase().includes(searchQuery))
                );
            }
        } else {
            if (searchQuery !== '') {
                items = allItems.filter(i => 
                    !checkIsTrash(i) && (
                        (i.title && i.title.toLowerCase().includes(searchQuery)) ||
                        (i.text && i.text.toLowerCase().includes(searchQuery))
                    )
                );
            } else {
                items = allItems.filter(item => item.parentId === currentFolderId && !checkIsTrash(item));
            }
        }

        const sortMode = sortSelect ? sortSelect.value : 'updated-desc';
        items.sort((a, b) => {
            if (sortMode === 'updated-desc') {
                return new Date(b.updatedAt) - new Date(a.updatedAt);
            } else if (sortMode === 'updated-asc') {
                return new Date(a.updatedAt) - new Date(b.updatedAt);
            } else if (sortMode === 'title-asc') {
                return (a.title || '').localeCompare(b.title || '', 'ja');
            } else if (sortMode === 'title-desc') {
                return (b.title || '').localeCompare(a.title || '', 'ja');
            }
            return 0;
        });

        renderSections(items);
        renderBreadcrumb();
        updateBackButton();
    };
}

function renderBreadcrumb() {
    if (!breadcrumbEl) return;
    breadcrumbEl.innerHTML = '';
    pathStack.forEach((path, index) => {
        const span = document.createElement('span');
        span.className = 'breadcrumb-item';
        span.textContent = path.title;
        span.addEventListener('click', () => {
            if (index < pathStack.length - 1) {
                pathStack = pathStack.slice(0, index + 1);
                currentFolderId = path.id;
                loadItems();
            }
        });
        breadcrumbEl.appendChild(span);

        if (index < pathStack.length - 1) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = '＞';
            breadcrumbEl.appendChild(sep);
        }
    });
}

// フォルダ段（1段目）とメモ段（2段目）に分離して描写
function renderSections(items) {
    if (!mainView) return;
    mainView.innerHTML = '';

    if (currentFolderId === 'trash') {
        const trashBanner = document.createElement('div');
        trashBanner.className = 'trash-banner';
        trashBanner.innerHTML = `
            <span>🗑️ ゴミ箱の管理</span>
            <button class="btn-empty-trash-banner red push" id="btn-empty-trash">🗑️ 空にする</button>
        `;
        trashBanner.querySelector('#btn-empty-trash').addEventListener('click', emptyTrash);
        mainView.appendChild(trashBanner);

        const trashContainer = document.createElement('div');
        trashContainer.className = 'list-row-container';
        items.forEach(item => trashContainer.appendChild(createListItem(item)));
        mainView.appendChild(trashContainer);
        return;
    }

    const folders = items.filter(i => i.type === 'folder');
    const notes = items.filter(i => i.type === 'note');

    // 1段目: フォルダ領域
    const folderSection = document.createElement('div');
    folderSection.className = 'section-container';
    folderSection.innerHTML = `<div class="section-title">📁 フォルダ</div>`;
    const folderRow = document.createElement('div');
    folderRow.className = 'list-row-container';

    // ルートの場合ゴミ箱も先頭表示
    const searchQuery = searchInput ? searchInput.value.trim() : '';
    if (currentFolderId === 'root' && searchQuery === '') {
        const trashItem = document.createElement('div');
        trashItem.className = 'list-item trash-folder';
        trashItem.innerHTML = `
            <div class="list-item-icon">🗑️</div>
            <div class="list-item-info">
                <div class="list-item-title">ゴミ箱</div>
            </div>
        `;
        trashItem.addEventListener('click', openTrash);
        folderRow.appendChild(trashItem);
    }

    folders.forEach(item => folderRow.appendChild(createListItem(item)));
    folderSection.appendChild(folderRow);
    mainView.appendChild(folderSection);

    // 2段目: メモ領域
    const noteSection = document.createElement('div');
    noteSection.className = 'section-container';
    noteSection.innerHTML = `<div class="section-title">📄 メモ</div>`;
    const noteRow = document.createElement('div');
    noteRow.className = 'list-row-container';

    notes.forEach(item => noteRow.appendChild(createListItem(item)));
    noteSection.appendChild(noteRow);
    mainView.appendChild(noteSection);

    if (items.length === 0) {
    let emptyMsg = searchQuery !== '' ? '見つかりませんでした... 🔍' : 'ここは空です<br>+ Add で作れるよ 🪄';
    mainView.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
} else {
    // 中身がある場合は「フォルダ」「メモ」の各セクションを追加
    mainView.appendChild(folderSection);
    mainView.appendChild(noteSection);
}
}

// リスト要素生成
function createListItem(item) {
    const el = document.createElement('div');
    el.className = `list-item ${item.type}`;

    const icon = item.type === 'folder' ? '📁' : '📄';
    const charCount = item.type === 'note' ? `${item.text ? item.text.length : 0}文字` : '';
    const displayTitle = escapeHTML(item.title) || getDefaultTitle();

    if (currentFolderId === 'trash') {
        el.innerHTML = `
            <div class="list-item-icon">${icon}</div>
            <div class="list-item-info">
                <div class="list-item-title">${displayTitle}</div>
            </div>
            <div class="list-item-actions">
                <button class="card-btn card-restore" title="復元">↩️</button>
                <button class="card-btn card-delete-perm" title="削除">×</button>
            </div>
        `;
        el.querySelector('.card-restore').addEventListener('click', (e) => {
            e.stopPropagation();
            restoreItem(item.id);
        });
        el.querySelector('.card-delete-perm').addEventListener('click', (e) => {
            e.stopPropagation();
            deletePermanently(item.id);
        });
    } else {
        const editBtnHtml = item.type === 'folder' ? `<button class="card-btn card-edit" title="名前変更">✏️</button>` : '';
        el.innerHTML = `
            <div class="list-item-icon">${icon}</div>
            <div class="list-item-info">
                <div class="list-item-title">${displayTitle}</div>
                ${charCount ? `<div class="list-item-sub">${charCount}</div>` : ''}
            </div>
            <div class="list-item-actions">
                ${editBtnHtml}
                <button class="card-btn card-move" title="移動">🚐</button>
                <button class="card-btn card-delete" title="ゴミ箱へ">🗑️</button>
            </div>
        `;

        if (item.type === 'folder') {
            const btnEdit = el.querySelector('.card-edit');
            if (btnEdit) {
                btnEdit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    renameFolder(item.id, item.title);
                });
            }
        }

        el.querySelector('.card-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            moveToTrash(item.id);
        });

        el.querySelector('.card-move').addEventListener('click', (e) => {
            e.stopPropagation();
            openMoveModalForItem(item.id, item.type, item.title);
        });

        el.addEventListener('click', () => {
            if (item.type === 'folder') {
                openFolder(item.id, item.title);
            } else {
                openEditor(item.id);
            }
        });
    }

    return el;
}

function openFolder(id, title) {
    pathStack.push({ id: id, title: title || getDefaultTitle() });
    currentFolderId = id;
    loadItems();
}

function openTrash() {
    pathStack.push({ id: 'trash', title: 'ゴミ箱' });
    currentFolderId = 'trash';
    loadItems();
}

function goBack() {
    if (editorView && editorView.style.display === 'block') {
        switchView('gallery');
        return;
    }
    if (pathStack.length <= 1) return;
    pathStack.pop();
    const prev = pathStack[pathStack.length - 1];
    currentFolderId = prev.id;
    loadItems();
}

function updateBackButton() {
    if (btnBack) {
        btnBack.disabled = pathStack.length <= 1 && editorView.style.display !== 'block';
    }
}

// ==========================================
// 5. Undo / Redo ＆ エディタ機能
// ==========================================
function resetUndoHistory(initialText) {
    undoStack = [initialText];
    redoStack = [];
}

function recordUndoState() {
    if (!editorText) return;
    const currentText = editorText.value;
    const lastState = undoStack[undoStack.length - 1];

    if (currentText !== lastState) {
        undoStack.push(currentText);
        if (undoStack.length > MAX_STACK_SIZE) undoStack.shift();
        redoStack = [];
    }
}

function undoEditor() {
    if (undoStack.length > 1) {
        const currentState = undoStack.pop();
        redoStack.push(currentState);

        const previousState = undoStack[undoStack.length - 1];
        editorText.value = previousState;

        triggerAutoSave();
        showStatus('元に戻しました ↩️');
    } else {
        showStatus('これ以上戻せません');
    }
}

function copyAllText() {
    navigator.clipboard.writeText(editorText.value).then(() => {
        showStatus('コピーしました！📋');
    });
}

function clearEditorText() {
    if (editorText.value.length === 0) return;
    recordUndoState();
    editorText.value = '';
    recordUndoState();
    triggerAutoSave();
    showStatus('クリアしました 🧹');
}

function openEditor(id) {
    currentNoteId = id;

    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
        const item = request.result;
        if (item) {
            editorTitle.value = item.title || '';
            editorText.value = item.text || '';
            resetUndoHistory(editorText.value);
        }
        switchView('editor');
    };
}

function addNote() {
    currentNoteId = null;
    editorTitle.value = '';
    editorText.value = '';
    resetUndoHistory('');

    const defaultTitle = getDefaultTitle();

    const itemData = {
        title: defaultTitle,
        text: '',
        type: 'note',
        parentId: currentFolderId === 'trash' ? 'root' : currentFolderId,
        updatedAt: new Date().toISOString(),
        isTrash: false
    };

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.add(itemData);

    req.onsuccess = (e) => {
        currentNoteId = e.target.result;
        if (newModal) newModal.style.display = 'none';
        switchView('editor');
    };
}

function triggerAutoSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        recordUndoState();
        saveNoteRealtime();
    }, 400);
}

function saveNoteRealtime() {
    if (currentNoteId === null) return;

    // 空欄時は現在の日時をデフォルト適用
    const title = editorTitle.value.trim() || getDefaultTitle();
    const text = editorText.value;
    const updatedAt = new Date().toISOString();

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(currentNoteId);

    getReq.onsuccess = () => {
        const itemData = getReq.result || {};
        itemData.id = currentNoteId;
        itemData.title = title;
        itemData.text = text;
        itemData.type = 'note';
        if (!itemData.parentId) itemData.parentId = currentFolderId === 'trash' ? 'root' : currentFolderId;
        itemData.updatedAt = updatedAt;
        itemData.isTrash = false;

        store.put(itemData);
        showStatus('自動保存完了 ✨');
    };
}

// ==========================================
// 6. UI表示切り替え
// ==========================================
function switchView(view) {
    const searchContainer = document.querySelector('.search-container');

    if (view === 'gallery') {
        if (editorView) editorView.style.display = 'none';
        if (mainView) mainView.style.display = 'block';
        if (searchContainer) searchContainer.style.display = 'block';
        if (breadcrumbEl) breadcrumbEl.style.display = 'block';

        if (btnNew) btnNew.style.display = currentFolderId === 'trash' ? 'none' : 'inline-block';
        if (btnMove) btnMove.style.display = 'none';
        if (btnDelete) btnDelete.style.display = 'none';
        if (btnClearHeader) btnClearHeader.style.display = 'none';

        loadItems();
    } else {
        if (editorView) editorView.style.display = 'block';
        if (mainView) mainView.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'none';
        if (breadcrumbEl) breadcrumbEl.style.display = 'none';

        if (btnNew) btnNew.style.display = 'none';
        if (btnClearHeader) btnClearHeader.style.display = 'inline-block';
        if (btnMove) btnMove.style.display = 'inline-block';
        if (btnDelete) btnDelete.style.display = 'inline-block';

        if (editorText) editorText.focus();
        
    }
    updateBackButton();
}

// ==========================================
// 7. ゴミ箱・移動・削除・フォルダ関連処理
// ==========================================
function addFolder(rawName) {
    const folderName = (!rawName || rawName.trim() === '') ? getDefaultTitle() : rawName.trim();

    const folderData = {
        title: folderName,
        type: 'folder',
        parentId: currentFolderId === 'trash' ? 'root' : currentFolderId,
        updatedAt: new Date().toISOString(),
        isTrash: false
    };

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.add(folderData);

    transaction.oncomplete = () => {
        showStatus('フォルダ作成！ 📁');
        if (newModal) newModal.style.display = 'none';
        loadItems();
    };
}

function renameFolder(folderId, currentTitle) {
    let newName = prompt("フォルダ名を入力しよう！🐱:", currentTitle);

    if (newName !== null) {
        const finalName = newName.trim() === "" ? getDefaultTitle() : newName.trim();

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const req = store.get(folderId);

        req.onsuccess = () => {
            const item = req.result;
            if (item) {
                item.title = finalName;
                item.updatedAt = new Date().toISOString();
                store.put(item);
            }
        };

        transaction.oncomplete = () => {
            showStatus('フォルダ名を変更しました！ ✏️');
            loadItems();
        };
    }
}

function moveToTrash(id) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
        const item = req.result;
        if (item) {
            item.isTrash = true;
            store.put(item);
        }
    };

    transaction.oncomplete = () => {
        showStatus('ゴミ箱へ移動しました 🗑️');
        if (editorView && editorView.style.display === 'block') {
            switchView('gallery');
        } else {
            loadItems();
        }
    };
}

function restoreItem(id) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
        const item = req.result;
        if (item) {
            item.isTrash = false;
            store.put(item);
        }
    };

    transaction.oncomplete = () => {
        showStatus('復元しました ↩️');
        loadItems();
    };
}

function deletePermanently(id) {
    if (!confirm('完全に削除しますか？（フォルダ内のメモも全て削除されます）')) return;

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
        const allItems = req.result || [];
        const idsToDelete = [id, ...getAllDescendantIds(id, allItems)];

        idsToDelete.forEach(deleteId => {
            store.delete(deleteId);
        });
    };

    transaction.oncomplete = () => {
        showStatus('完全削除しました ✖');
        loadItems();
    };
}

function emptyTrash() {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
        const allItems = req.result || [];
        const trashItems = allItems.filter(item => checkIsTrash(item));

        if (trashItems.length === 0) {
            showStatus('すでに空だよ 🗑️');
            return;
        }

        if (confirm(`ゴミ箱の中にあるアイテムをすべて完全に削除しますか？\n※元に戻せないけど本当に削除していいですか...？🐱`)) {
            let allDeleteIds = new Set();
            trashItems.forEach(item => {
                allDeleteIds.add(item.id);
                if (item.type === 'folder') {
                    const descendants = getAllDescendantIds(item.id, allItems);
                    descendants.forEach(dId => allDeleteIds.add(dId));
                }
            });

            const deleteTx = db.transaction([STORE_NAME], 'readwrite');
            const deleteStore = deleteTx.objectStore(STORE_NAME);

            allDeleteIds.forEach(delId => {
                deleteStore.delete(delId);
            });

            deleteTx.oncomplete = () => {
                showStatus('ゴミ箱を完全に空にしました 🧹');
                loadItems();
            };
        }
    };
}

function openMoveModalForItem(id, type, title) {
    itemToMoveId = id;
    if (moveModalTitle) moveModalTitle.textContent = `「${title || '無題'}」の移動先を選択`;

    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const allItems = request.result || [];
        const itemMap = new Map();
        allItems.forEach(item => itemMap.set(item.id, item));

        const folders = allItems.filter(item => {
            if (item.type !== 'folder') return false;
            if (item.id === id) return false;
            if (isDescendantOf(item.id, id, itemMap)) return false;
            if (isFolderInTrash(item, itemMap)) return false;
            return true;
        });

        if (moveList) moveList.innerHTML = '';

        const rootBtn = document.createElement('div');
        rootBtn.className = 'green push';
        rootBtn.textContent = '🏠 to Home';
        rootBtn.style.padding = '8px';
        rootBtn.style.cursor = 'pointer';
        rootBtn.addEventListener('click', () => {
            performMove(id, 'root');
        });
        if (moveList) moveList.appendChild(rootBtn);

        folders.forEach(folder => {
            const div = document.createElement('div');
            div.className = 'move-item';
            div.textContent = `📁 ${folder.title}`;
            div.style.padding = '8px';
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => {
                performMove(id, folder.id);
            });
            if (moveList) moveList.appendChild(div);
        });

        if (moveModal) moveModal.style.display = 'block';
    };
}

function performMove(id, newParentId) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
        const item = req.result;
        if (item) {
            item.parentId = newParentId;
            item.updatedAt = new Date().toISOString();
            store.put(item);
        }
    };

    transaction.oncomplete = () => {
        if (moveModal) moveModal.style.display = 'none';
        showStatus('移動しました 📦');
        loadItems();
    };
}

// ==========================================
// 8. イベントリスナー設定 ＆ 初期化起動
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => {
        createFireflies();
        switchView('gallery');
    }).catch(err => {
        console.error("DB初期化失敗:", err);
    });

    if (btnBack) btnBack.addEventListener('click', goBack);

    if (btnNew) {
        btnNew.addEventListener('click', () => {
            if (newModal) newModal.style.display = 'block';
        });
    }

    if (btnNewFolder) {
        btnNewFolder.addEventListener('click', () => {
            const name = prompt("フォルダ名を入力しよう!🐱");
            if (name !== null) {
                addFolder(name);
            }
        });
    }

    if (btnNewNote) {
        btnNewNote.addEventListener('click', () => {
            addNote();
        });
    }

    if (btnNewCancel) {
        btnNewCancel.addEventListener('click', () => {
            if (newModal) newModal.style.display = 'none';
        });
    }

    if (btnMoveCancel) {
        btnMoveCancel.addEventListener('click', () => {
            if (moveModal) moveModal.style.display = 'none';
        });
    }

    // モーダル外枠クリックで閉じる処理 (⑧)
    if (newModal) {
        newModal.addEventListener('click', (e) => {
            if (e.target === newModal) {
                newModal.style.display = 'none';
            }
        });
    }
    if (moveModal) {
        moveModal.addEventListener('click', (e) => {
            if (e.target === moveModal) {
                moveModal.style.display = 'none';
            }
        });
    }

    if (btnDelete) {
        btnDelete.addEventListener('click', () => {
            if (currentNoteId !== null) moveToTrash(currentNoteId);
        });
    }

    if (btnMove) {
        btnMove.addEventListener('click', () => {
            if (currentNoteId !== null) {
                openMoveModalForItem(currentNoteId, 'note', editorTitle.value);
            }
        });
    }

    if (btnClearHeader) btnClearHeader.addEventListener('click', clearEditorText);
    if (btnUndo) btnUndo.addEventListener('click', undoEditor);
    if (btnCopy) btnCopy.addEventListener('click', copyAllText);
    if (btnClear) btnClear.addEventListener('click', clearEditorText);

    // タイトル全クリアボタン (③)
    if (btnTitleClear) {
        btnTitleClear.addEventListener('click', () => {
            if (editorTitle) {
                editorTitle.value = '';
                triggerAutoSave();
            }
        });
    }

    if (editorTitle) editorTitle.addEventListener('input', triggerAutoSave);

    if (editorText) {
        editorText.addEventListener('input', triggerAutoSave);
        editorText.addEventListener('paste', () => recordUndoState());
        editorText.addEventListener('cut', () => recordUndoState());
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => loadItems());
    }
    if (btnSearchClear) {
        btnSearchClear.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            loadItems();
        });
    }
    if (sortSelect) {
        sortSelect.addEventListener('change', () => loadItems());
    }
});

function setupTouchEvents() {
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

mainView.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      const pointerY = e.touches[0].clientY;
      const rect = mainView.getBoundingClientRect();
      const threshold = 40;

      if (pointerY < rect.top + threshold) {
        mainView.scrollTop -= AUTO_SCROLL_SPEED;
      } else if (pointerY > rect.bottom - threshold) {
        mainView.scrollTop += AUTO_SCROLL_SPEED;
      }
    }
  }, { passive: true });
}







