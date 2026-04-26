<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface TodoItem {
  id: number;
  title: string;
  body: string;
  done: boolean;
}

const STORAGE_KEY = 'pixi-features-todo';

function load(): TodoItem[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

const items = ref<TodoItem[]>(load());
let nextId = items.value.reduce((m, i) => Math.max(m, i.id + 1), 0);

watch(items, val => localStorage.setItem(STORAGE_KEY, JSON.stringify(val)), { deep: true });

const activeTab = ref<'active' | 'done'>('active');
const selectedId = ref<number | null>(null);

// New item form
const addingNew = ref(false);
const newTitle = ref('');
const newBody = ref('');

const active = computed(() => items.value.filter(i => !i.done));
const done   = computed(() => items.value.filter(i => i.done));
const listed = computed(() => activeTab.value === 'active' ? active.value : done.value);

const selected = computed(() => items.value.find(i => i.id === selectedId.value) ?? null);

function select(id: number) {
  selectedId.value = selectedId.value === id ? null : id;
}

function toggle(item: TodoItem) {
  item.done = !item.done;
  // If completed item was selected, deselect
  if (item.done && selectedId.value === item.id) selectedId.value = null;
  // Switch to done tab briefly so user sees it land there? No — keep them on active.
}

function addItem() {
  const title = newTitle.value.trim();
  if (!title) return;
  items.value.push({ id: nextId++, title, body: newBody.value.trim(), done: false });
  newTitle.value = '';
  newBody.value = '';
  addingNew.value = false;
}

function cancelAdd() {
  newTitle.value = '';
  newBody.value = '';
  addingNew.value = false;
}

function deleteItem(id: number) {
  items.value = items.value.filter(i => i.id !== id);
  if (selectedId.value === id) selectedId.value = null;
}

function updateSelected(field: 'title' | 'body', val: string) {
  const item = items.value.find(i => i.id === selectedId.value);
  if (item) item[field] = val;
}
</script>

<template>
  <div class="todo-panel">
    <!-- Header -->
    <div class="todo-header">
      <span class="todo-title">Todo</span>
      <div class="todo-tabs">
        <button :class="{ active: activeTab === 'active' }" @click="activeTab = 'active'">
          Active <span class="badge" v-if="active.length">{{ active.length }}</span>
        </button>
        <button :class="{ active: activeTab === 'done' }" @click="activeTab = 'done'">
          Done <span class="badge done-badge" v-if="done.length">{{ done.length }}</span>
        </button>
      </div>
    </div>

    <!-- List -->
    <div class="todo-list">
      <div
        v-for="item in listed" :key="item.id"
        class="todo-item"
        :class="{ selected: selectedId === item.id, done: item.done }"
        @click="select(item.id)"
      >
        <input
          type="checkbox"
          :checked="item.done"
          @click.stop
          @change="toggle(item)"
          class="todo-checkbox"
        />
        <span class="todo-item-title">{{ item.title }}</span>
        <button class="todo-delete" @click.stop="deleteItem(item.id)" title="Delete">×</button>
      </div>

      <div v-if="listed.length === 0" class="todo-empty">
        {{ activeTab === 'active' ? 'Nothing here yet.' : 'Nothing completed yet.' }}
      </div>
    </div>

    <!-- Selected item body -->
    <div v-if="selected" class="todo-body-area">
      <div class="todo-body-label">{{ selected.title }}</div>
      <textarea
        class="todo-body-text"
        :value="selected.body"
        @input="updateSelected('body', ($event.target as HTMLTextAreaElement).value)"
        placeholder="Add notes…"
        rows="5"
      />
    </div>

    <!-- Add new item -->
    <div class="todo-add-area">
      <template v-if="!addingNew">
        <button class="todo-add-btn" @click="addingNew = true">+ Add item</button>
      </template>
      <template v-else>
        <input
          v-model="newTitle"
          class="todo-new-title"
          placeholder="Title…"
          @keydown.enter="addItem"
          @keydown.escape="cancelAdd"
          autofocus
        />
        <textarea
          v-model="newBody"
          class="todo-new-body"
          placeholder="Notes (optional)…"
          rows="3"
          @keydown.escape="cancelAdd"
        />
        <div class="todo-new-actions">
          <button class="todo-save-btn" @click="addItem">Add</button>
          <button class="todo-cancel-btn" @click="cancelAdd">Cancel</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.todo-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #141414;
  border-left: 1px solid #2a2a2a;
  font-family: monospace;
  font-size: 12px;
  color: #ccc;
  overflow: hidden;
}

.todo-header {
  padding: 10px 10px 0;
  flex-shrink: 0;
}

.todo-title {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #555;
  margin-bottom: 8px;
}

.todo-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #222;
  padding-bottom: 0;
}

.todo-tabs button {
  padding: 4px 10px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #555;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  margin-bottom: -1px;
}
.todo-tabs button.active {
  color: #ccc;
  border-bottom-color: #0070e0;
}
.todo-tabs button:hover:not(.active) { color: #888; }

.badge {
  display: inline-block;
  background: #0070e0;
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  font-size: 9px;
  margin-left: 3px;
  line-height: 14px;
}
.done-badge { background: #333; color: #888; }

.todo-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
  min-height: 0;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.todo-item:hover { background: #1e1e1e; }
.todo-item.selected {
  background: #1a2a3a;
  border-left-color: #0070e0;
}
.todo-item.done .todo-item-title {
  text-decoration: line-through;
  color: #444;
}

.todo-checkbox {
  flex-shrink: 0;
  accent-color: #0070e0;
  cursor: pointer;
}

.todo-item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #bbb;
}

.todo-delete {
  opacity: 0;
  background: transparent;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.todo-item:hover .todo-delete { opacity: 1; }
.todo-delete:hover { color: #cc4444; }

.todo-empty {
  padding: 12px 10px;
  color: #444;
  font-style: italic;
}

.todo-body-area {
  border-top: 1px solid #222;
  padding: 10px;
  flex-shrink: 0;
}

.todo-body-label {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-body-text {
  width: 100%;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 11px;
  padding: 6px 8px;
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.5;
}
.todo-body-text:focus { outline: none; border-color: #0070e0; }

.todo-add-area {
  border-top: 1px solid #222;
  padding: 8px 10px;
  flex-shrink: 0;
}

.todo-add-btn {
  background: transparent;
  border: 1px dashed #333;
  color: #555;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 3px;
  width: 100%;
}
.todo-add-btn:hover { border-color: #555; color: #888; }

.todo-new-title {
  width: 100%;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 12px;
  padding: 5px 8px;
  box-sizing: border-box;
  margin-bottom: 5px;
}
.todo-new-title:focus { outline: none; border-color: #0070e0; }

.todo-new-body {
  width: 100%;
  background: #0e0e0e;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 11px;
  padding: 5px 8px;
  box-sizing: border-box;
  resize: none;
  margin-bottom: 6px;
  line-height: 1.5;
}
.todo-new-body:focus { outline: none; border-color: #0070e0; }

.todo-new-actions { display: flex; gap: 6px; }

.todo-save-btn {
  background: #0070e0;
  border: none;
  color: #fff;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 14px;
  border-radius: 3px;
}
.todo-save-btn:hover { background: #0060c0; }

.todo-cancel-btn {
  background: #2a2a2a;
  border: 1px solid #444;
  color: #888;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 3px;
}
.todo-cancel-btn:hover { color: #ccc; }
</style>
