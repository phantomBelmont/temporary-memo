// ==========================================
// 0. セキュリティ対策（XSSエスケープ）
// ==========================================
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

// ゴミ箱判定の確実なヘルパー関数
function checkIsTrash(item) {
    if (!item) return false;
    return item.isTrash === true || item.isTrash === 'true' || item.isTrash === 1;
}

// ==========================================
// 2. DOM要素の取得
// ==========================================
const mainView = document.getElementById('main-view');
const currentPathTitle = document.getElementById('current-path');
const breadcrumbEl = document.getElementById('breadcrumb');
const btnBack = document.getElementById('btn-back');
const btnNew = document.getElementById('btn-new');
const btnMove = document.getElementById('btn-move');
const btnDelete = document.getElementById('btn-delete');
const btnSave = document.getElementById('btn-save');
const btnUndo = document.getElementById('btn-undo');
const btnCopy = document.getElementById('btn-copy');
const btnClear = document.getElementById('btn-clear');

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

// DB内のデータ不整合・孤立フォルダの一括クリーンアップ
function sanitizeDatabase() {
    return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
            const items = req.result || [];
            const itemMap = new Map();
            items.forEach(item => itemMap.set(item.id, item));

            // 親が存在しない孤立フォルダ・ノートを検出してDBから一掃する
            items.forEach(item => {
                // 1. isTrashの補正
                if (item.isTrash === undefined || item.isTrash === null) {
                    item.isTrash = false;
                    store.put(item);
                }

                // 2. 孤立アイテムの削除（親がroot/trash以外で、親アイテムがDB上に存在しないもの）
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

// 自分または先祖フォルダがゴミ箱に入っているか（＋親が存在しない孤立フォルダでないか）完全判定
function isFolderInTrash(folder, itemMap) {
    let current = folder;
    let visited = new Set();
    
    while (current) {
        if (checkIsTrash(current)) return true;
        
        // 親がrootなら正常なフォルダ構造
        if (current.parentId === 'root') return false;
        if (current.parentId === 'trash') return true;
        if (!current.parentId) return false;

        if (visited.has(current.parentId)) break;
        visited.add(current.parentId);

        // 親フォルダが存在しない＝削除済み親の残骸（孤立フォルダ）なのでゴミ箱同等扱いにして除外
        if (!itemMap.has(current.parentId)) {
            return true;
        }

        current = itemMap.get(current.parentId);
    }
    return false;
}

// 移動対象フォルダの子孫フォルダかどうか判定（循環参照防止）
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

// 指定したIDの配下にある全子孫アイテムのIDリストを取得する関数
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

        renderGallery(items);
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
                if (currentPathTitle) currentPathTitle.textContent = path.title;
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

function renderGallery(items) {
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
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = `card ${item.type}`;
        
        const icon = item.type === 'folder' ? '📁' : '📄';
        const subText = item.type === 'folder' ? '' : `${item.text ? item.text.length : 0} 文字`;

        if (currentFolderId === 'trash') {
            card.innerHTML = `
                <div class="icon">${icon}</div>
                <div class="card-title">${escapeHTML(item.title) || '無題'}</div>
                <div class="card-sub">${escapeHTML(subText)}</div>
                <div style="margin-top:10px;">
                    <button class="card-restore-btn" style="background:#070;color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;">↩️ 復元</button>
                    <button class="card-delete-perm-btn" style="background:#ef4444;color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;">× 削除</button>
                </div>
            `;

            card.querySelector('.card-restore-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                restoreItem(item.id);
            });
            card.querySelector('.card-delete-perm-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deletePermanently(item.id);
            });
        } else {
            const editBtnHtml = item.type === 'folder' ? `<button class="card-btn card-edit" title="名前変更">✏️</button>` : '';
            card.innerHTML = `
                <div class="card-actions">
                    ${editBtnHtml}
                    <button class="card-btn card-move" title="移動">📦</button>
                    <button class="card-btn card-delete" title="ゴミ箱へ">🗑️</button>
                </div>
                <div class="icon">${icon}</div>
                <div class="card-title">${escapeHTML(item.title) || '無題'}</div>
                <div class="card-sub">${escapeHTML(subText)}</div>
            `;

            if (item.type === 'folder') {
                const btnEdit = card.querySelector('.card-edit');
                if (btnEdit) {
                    btnEdit.addEventListener('click', (e) => {
                        e.stopPropagation();
                        renameFolder(item.id, item.title);
                    });
                }
            }

            card.querySelector('.card-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                moveToTrash(item.id);
            });

            card.querySelector('.card-move').addEventListener('click', (e) => {
                e.stopPropagation();
                openMoveModalForItem(item.id, item.type, item.title);
            });

            card.addEventListener('click', () => {
                if (item.type === 'folder') {
                    openFolder(item.id, item.title);
                } else {
                    openEditor(item.id);
                }
            });
        }

        mainView.appendChild(card);
    });

    const searchQuery = searchInput ? searchInput.value.trim() : '';

    if (currentFolderId === 'root' && searchQuery === '') {
        const trashCard = document.createElement('div');
        trashCard.className = 'card trash-folder';
        trashCard.innerHTML = `
            <div class="icon">🗑️</div>
            <div class="card-title">ゴミ箱</div>
        `;
        trashCard.addEventListener('click', openTrash);
        mainView.appendChild(trashCard);
    } else if (items.length === 0 && currentFolderId !== 'trash') {
        let emptyMsg = searchQuery !== '' ? '見つかりませんでした... 🔍' : 'ここは空です<br>+ Add で作れるよ 🪄';
        mainView.innerHTML += `<div class="empty-state">${emptyMsg}</div>`;
    }
}

function openFolder(id, title) {
    pathStack.push({ id: id, title: title });
    currentFolderId = id;
    if (currentPathTitle) currentPathTitle.textContent = title;
    loadItems();
}

function openTrash() {
    pathStack.push({ id: 'trash', title: 'ゴミ箱' });
    currentFolderId = 'trash';
    if (currentPathTitle) currentPathTitle.textContent = 'ゴミ箱';
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
    if (currentPathTitle) currentPathTitle.textContent = prev.title;
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

    const itemData = {
        title: '無題',
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

    const title = editorTitle.value.trim() || '無題';
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
        if (btnUndo) btnUndo.style.display = 'none';
        if (btnCopy) btnCopy.style.display = 'none';
        if (btnClear) btnClear.style.display = 'none';
        if (btnSave) btnSave.style.display = 'none';

        loadItems();
    } else {
        if (editorView) editorView.style.display = 'block';
        if (mainView) mainView.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'none';
        if (breadcrumbEl) breadcrumbEl.style.display = 'none';

        if (btnNew) btnNew.style.display = 'none';
        if (btnMove) btnMove.style.display = 'inline-block';
        if (btnDelete) btnDelete.style.display = 'inline-block';
        if (btnUndo) btnUndo.style.display = 'inline-block';
        if (btnCopy) btnCopy.style.display = 'inline-block';
        if (btnClear) btnClear.style.display = 'inline-block';
        if (btnSave) btnSave.style.display = 'none';

        if (editorTitle) editorTitle.focus();
    }
    updateBackButton();
}

// ==========================================
// 7. ゴミ箱・移動・削除・フォルダ関連処理
// ==========================================
function addFolder(rawName) {
    const folderName = (rawName || '').trim() === '' ? '無題' : rawName.trim();

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
        const finalName = newName.trim() === "" ? "無題" : newName.trim();

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

// 単体完全削除（子要素も連鎖削除）
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

// ゴミ箱を空にする（配下の子フォルダ・子メモも完全追跡して連鎖削除）
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
            // 削除対象IDの収集（ゴミ箱直下のアイテム ＋ その配下の全子孫）
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

        // 厳格フィルタ:
        // 1. フォルダであること
        // 2. 自分自身ではないこと
        // 3. 自分自身の子孫フォルダではないこと
        // 4. 先祖も含めゴミ箱内（isTrash: true）または親不在の孤立フォルダでないこと
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

function openMoveModal() {
    if (currentNoteId !== null) {
        openMoveModalForItem(currentNoteId, 'note', editorTitle ? editorTitle.value : '');
    }
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

    if (btnUndo) btnUndo.addEventListener('click', undoEditor);
    if (btnCopy) btnCopy.addEventListener('click', copyAllText);
    if (btnClear) btnClear.addEventListener('click', clearEditorText);

    if (editorTitle) editorTitle.addEventListener('input', triggerAutoSave);
    
    if (editorText) {
        editorText.addEventListener('input', triggerAutoSave);

        editorText.addEventListener('paste', () => {
            recordUndoState();
        });
        editorText.addEventListener('cut', () => {
            recordUndoState();
        });
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
