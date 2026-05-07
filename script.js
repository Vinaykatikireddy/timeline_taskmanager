    class StateStore {
        constructor() {
            this.state = {
                zoom: 1,
                snapMinutes: 5,
                darkMode: true,
            
                selectedDate: this.getTodayDate(),
            
                tasks: [],
            
                projectedTasks: null,
            
                draggers: {
                    top: {
                        minute: 360,
                        locked: false
                    },
                    bottom: {
                        minute: 900,
                        locked: false
                    }
                },
            
                scalingSession: null
            };
        }

        getTodayDate() {
            return new Date().toISOString().split("T")[0];
        }
        
        getStorageKey(date) {
            return `timeline_tasks_${date}`;
        }

        loadTasks(date) {
            const raw = localStorage.getItem(this.getStorageKey(date));

            if (!raw) return [];
        
            try {
                return JSON.parse(raw);
            }
            catch {
                return [];
            }
        }
        
        saveTasks(date, tasks) {
            localStorage.setItem(
                this.getStorageKey(date),
                JSON.stringify(tasks)
            );
        }

        update(fn) {
            fn(this.state);
        }
        get() {
            return this.state;
        }
    }

    class TimelineEngine {
        static DAY_MINUTES = 1440;
        constructor() {
            this.basePxPerMinute = 1;
            this.updateViewportScale();
        }
        updateViewportScale() {
            const viewportHeight = window.innerHeight - 120;
            this.basePxPerMinute = viewportHeight / 1440;
        }
        getMinimumZoom(containerHeight) {
            const baseTimelineHeight = (1440 * this.basePxPerMinute) + 20;
            return containerHeight / baseTimelineHeight;
        }
        minuteToY(minute, zoom) {
            return minute * this.basePxPerMinute * zoom;
        }
        yToMinute(y, zoom) {
            return y / (this.basePxPerMinute * zoom);
        }
        clampMinute(minute) {
            return Math.max( 0, Math.min(1440, minute));
        }
        snapMinute(minute, snap) {
            return Math.round(minute / snap) * snap;
        }
    }

    class ScalingEngine {
        begin(tasks, anchorMinute, movingMinute) {
            return {
                    anchorMinute,
                    originalMovingMinute: movingMinute,
                    originalDistance: Math.abs(movingMinute - anchorMinute),
                    originalTasks: structuredClone(tasks)
            };
        }
        scale(session, currentMovingMinute) {
            const {
                anchorMinute,
                originalMovingMinute,
                originalDistance,
                originalTasks
            } = session;
            const newDistance = Math.abs(currentMovingMinute - anchorMinute);
            const scaleFactor = newDistance / originalDistance;
            const minRegion = Math.min(anchorMinute, originalMovingMinute);
            const maxRegion = Math.max(anchorMinute, originalMovingMinute);
            return {
                scaleFactor,
                tasks: originalTasks.map(task => {
                    const inside = task.startMinute >= minRegion && task.endMinute <= maxRegion;
                    if (!inside) {
                        return structuredClone(task);
                    }
                    const newStart = anchorMinute + ( task.startMinute - anchorMinute ) * scaleFactor;
                    const newEnd = anchorMinute + ( task.endMinute - anchorMinute ) * scaleFactor;
                    return {
                            ...task,
                            startMinute: Math.max(0, Math.min(1440, newStart)),
                            endMinute: Math.max( newStart + 1, Math.min(1440, newEnd) )
                    };
                })
            };
        }
    }

    class RenderScheduler {
        constructor(renderFn) {
            this.renderFn = renderFn;
            this.pending = false;
        }
        request() {
            if (this.pending) return;
            this.pending = true;
            requestAnimationFrame(() => {
                this.pending = false;
                this.renderFn();
            });
        }
    }
    class App {
        constructor() {
            this.store = new StateStore();
            this.timelineEngine = new TimelineEngine();
            this.scalingEngine = new ScalingEngine();
            this.dom = {
                timeline:       document.getElementById("timeline"),
                gridLayer:      document.getElementById("gridLayer"),
                taskLayer:      document.getElementById("taskLayer"),
                draggerLayer:   document.getElementById("draggerLayer"),
                taskList:       document.getElementById("taskList"),
                form:           document.getElementById("taskForm"),
                titleInput:     document.getElementById("titleInput"),
                startInput:     document.getElementById("startInput"),
                endInput:       document.getElementById("endInput"),
                colorInput:     document.getElementById("colorInput"),
                datePicker:     document.getElementById("datePicker"),
                toggleAsideBtn: document.getElementById("toggleAsideBtn"), 
                sidePanel:      document.getElementById("sidePanel"),
                modalOverlay:   document.getElementById("modalOverlay"),
                modalTaskTitle: document.getElementById("modalTaskTitle"),
                modalTaskStart: document.getElementById("modalTaskStart"),
                modalTaskEnd:   document.getElementById("modalTaskEnd"),
                modalSaveBtn:   document.getElementById("modalSaveBtn"),
                modalCancelBtn: document.getElementById("modalCancelBtn")
            };
            this.dragState = null;
            this.renderer =
                new RenderScheduler(() => this.render());
            this.setup();
        }
        setup() {
            const state = this.store.get();

            state.tasks =
                this.store.loadTasks(
                    state.selectedDate
                );

            if (state.tasks.length === 0) {
                state.tasks = [
                    {
                        id: crypto.randomUUID(),
                        title: "Deep Work",
                        startMinute: 480,
                        endMinute: 600,
                        color: "#4f8cff",
                        completed: false
                    }
                ];
                
                this.store.saveTasks(
                    state.selectedDate,
                    state.tasks
                );
            }
            this.attachEvents();
            this.render();
            this.dom.datePicker.value = state.selectedDate;
        }

        persistTasks() {
            const state = this.store.get();
        
            this.store.saveTasks(
                state.selectedDate,
                state.tasks
            );
        }

        attachEvents() {
            window.addEventListener("resize", () => {
                const state = this.store.get();
                const container = document.getElementById("timelineSection");
                const centerY =
                    container.scrollTop +
                    container.clientHeight / 2;
            
                const centerMinute =
                    this.timelineEngine.yToMinute(
                        centerY,
                        state.zoom
                    );
            
                this.timelineEngine
                    .updateViewportScale();
            
                this.renderer.request();
            
                requestAnimationFrame(() => {
                    const newCenterY =
                        this.timelineEngine.minuteToY(
                            centerMinute,
                            state.zoom
                        );
                
                    container.scrollTop =
                        newCenterY -
                        container.clientHeight / 2;
                });
            });
        
            window.addEventListener("wheel",(e) => {
                if (!e.altKey) return;
                e.preventDefault();
                const state = this.store.get();
            
                const container =
                    document.getElementById(
                        "timelineSection"
                    );
                const rect =
                    container.getBoundingClientRect();
            
                const mouseY =
                    e.clientY - rect.top;
                const timelineY =
                    mouseY + container.scrollTop;
            
                const minuteBeforeZoom =
                    this.timelineEngine.yToMinute(
                        timelineY,
                        state.zoom
                    );
            
                const zoomDelta =
                    e.deltaY > 0
                        ? 0.9
                        : 1.1;
            
                state.zoom *= zoomDelta;
                const minZoom = this.timelineEngine.getMinimumZoom(container.clientHeight);
                state.zoom = Math.max(
                    minZoom,
                        Math.min(8, state.zoom)
                    );
                this.renderer.request();
            
                requestAnimationFrame(() => {
                    const newY =
                        this.timelineEngine.minuteToY(
                            minuteBeforeZoom,
                            state.zoom
                        );
                
                    container.scrollTop =
                        newY - mouseY;
                });
            
            },
                { passive: false }
            );
            
            this.dom.datePicker.addEventListener("change",(e) => {
                    const state = this.store.get();
                    state.selectedDate = e.target.value;
                    state.tasks = this.store.loadTasks(state.selectedDate);
                    this.renderer.request();
                }
            );

            this.dom.toggleAsideBtn.addEventListener("click",() => {
                const hidden = this.dom.sidePanel.style.display === "none";
                this.dom.sidePanel.style.display = hidden ? "block" : "none";
                this.dom.toggleAsideBtn.innerText = hidden ? "Hide Panel" : "Show Panel";
                requestAnimationFrame(() => { window.dispatchEvent( new Event("resize") ); });
            });

            this.dom.form.addEventListener("submit",e => {
                e.preventDefault();
                const title = this.dom.titleInput.value;
                const start = this.timeToMinute(this.dom.startInput.value);
                const end = this.timeToMinute(this.dom.endInput.value);
                if (start >= end) return;
                this.store.update(state => {
                    state.tasks.push({
                        id: crypto.randomUUID(),
                        title,
                        startMinute: start,
                        endMinute: end,
                        color: this.dom.colorInput.value,
                        completed: false
                    });
                });
                this.persistTasks();
                this.renderer.request();
            });
        }
        timeToMinute(time) {
            const [h, m] =
                time.split(":").map(Number);
            return h * 60 + m;
        }
        minuteToTime(minute) {
            const h =
                Math.floor(minute / 60);
            const m =
                Math.floor(minute % 60);
            return String(h).padStart(2, "0")
                + ":"
                + String(m).padStart(2, "0");
        }
        beginDrag(key, e) {
            const state = this.store.get();
            const current =
                state.draggers[key];
            const otherKey =
                key === "top"
                    ? "bottom"
                    : "top";
            const other =
                state.draggers[otherKey];
            if (
                current.locked &&
                other.locked
            ) {
                return;
            }
            if (current.locked) {
                return;
            }
            this.dragState = {
                key,
                otherKey
            };
            if (other.locked) {
                state.scalingSession =
                    this.scalingEngine.begin(
                        state.tasks,
                        other.minute,
                        current.minute
                    );
            }
            window.addEventListener(
                "pointermove",
                this.moveHandler
            );
            window.addEventListener(
                "pointerup",
                this.upHandler
            );
        }
        moveHandler = (e) => {
            const state = this.store.get();
            const rect =
                this.dom.timeline.getBoundingClientRect();
            let y =
                e.clientY - rect.top;
            let minute =
                this.timelineEngine.yToMinute(
                    y,
                    state.zoom
                );
            minute =
                this.timelineEngine.snapMinute(
                    minute,
                    state.snapMinutes
                );
            minute =
                this.timelineEngine.clampMinute(
                    minute
                );
            const current =
                state.draggers[this.dragState.key];
            const other =
                state.draggers[this.dragState.otherKey];
            const MIN_GAP = 15;
            if (
                other.minute > current.minute
            ) {
                minute =
                    Math.min(
                        minute,
                        other.minute - MIN_GAP
                    );
            }
            else {
                minute =
                    Math.max(
                        minute,
                        other.minute + MIN_GAP
                    );
            }
            current.minute = minute;
            if (
                state.scalingSession
            ) {
                const result =
                    this.scalingEngine.scale(
                        state.scalingSession,
                        minute
                    );
                state.projectedTasks =
                    result.tasks;
                state.currentScale =
                    result.scaleFactor;
            }
            this.renderer.request();
        }
        upHandler = () => {
            const state = this.store.get();
            if (state.projectedTasks) {
                state.tasks =
                    structuredClone(
                        state.projectedTasks
                    );
            }
            state.projectedTasks = null;
            state.scalingSession = null;
            this.dragState = null;
            this.persistTasks();
            window.removeEventListener(
                "pointermove",
                this.moveHandler
            );
            window.removeEventListener(
                "pointerup",
                this.upHandler
            );
            this.renderer.request();
        }
        render() {
            const state = this.store.get();
            const tasks =
                state.projectedTasks ||
                state.tasks;
            this.renderTimeline();
            this.renderTasks(tasks);
            this.renderDraggers();
            this.renderTaskList(tasks);
        }
        renderTimeline() {
            const state = this.store.get();
            const height =
                this.timelineEngine.minuteToY(
                    1440,
                    state.zoom
                );
            this.dom.timeline.style.height =
                height + "px";
            this.dom.gridLayer.innerHTML = "";
            for (
                let minute = 0;
                minute <= 1440;
                minute += 60
            ) {
                const line =
                    document.createElement("div");
                line.className = "hourLine";
                line.style.top =
                    this.timelineEngine.minuteToY(
                        minute,
                        state.zoom
                    ) + "px";
                line.innerText =
                    this.minuteToTime(minute);
                this.dom.gridLayer.appendChild(line);
            }
        }
        renderTasks(tasks) {
            const state = this.store.get();
            this.dom.taskLayer.innerHTML = "";
            const layoutTasks = [...tasks]
                .sort((a, b) => a.startMinute - b.startMinute);

            const columns = [];

            for (const task of layoutTasks) {
            
                let placed = false;
            
                for (let i = 0; i < columns.length; i++) {
                
                    const lastTask = columns[i][columns[i].length - 1];
                
                    const overlaps =
                        task.startMinute < lastTask.endMinute;
                
                    if (!overlaps) {
                        columns[i].push(task);
                        task.column = i;
                        placed = true;
                        break;
                    }
                }
            
                if (!placed) {
                    task.column = columns.length;
                    columns.push([task]);
                }
            }

            const totalColumns = columns.length;
            for (const task of tasks) {
                const el =
                    document.createElement("div");
                el.className = "task";
                const y =
                    this.timelineEngine.minuteToY(
                        task.startMinute,
                        state.zoom
                    );
                const height =
                    this.timelineEngine.minuteToY(
                        task.endMinute - task.startMinute,
                        state.zoom
                    );
                const widthPercent = 70 / totalColumns;

                el.style.top = y + "px";
                el.style.height = height + "px";
                el.style.background = task.color;

                el.style.left = (15 + (task.column * widthPercent)) + "%";

                el.style.width = `calc(${widthPercent}% - 6px)`;
                el.innerHTML = `
                    <strong>${task.title}</strong>
                    <div>
                        ${this.minuteToTime(task.startMinute)}
                        -
                        ${this.minuteToTime(task.endMinute)}
                    </div>
                `;
                this.dom.taskLayer.appendChild(el);
            }
        }
        renderDraggers() {
            const state = this.store.get();
            this.dom.draggerLayer.innerHTML = "";
            for (
                const [key, dragger]
                of Object.entries(state.draggers)
            ) {
                const el =
                    document.createElement("div");
                el.className =
                    "dragger"
                    + (
                        dragger.locked
                            ? " locked"
                            : ""
                    );
                el.style.top =
                    this.timelineEngine.minuteToY(
                        dragger.minute,
                        state.zoom
                    ) + "px";
                el.addEventListener(
                    "pointerdown",
                    e => this.beginDrag(key, e)
                );
                const btn = document.createElement("button");
                btn.className = "lockBtn";
                
                btn.innerText =
                    dragger.locked
                        ? "🔒"
                        : "🔓";
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.store.update(state => {
                        state.draggers[key].locked =
                            !state.draggers[key].locked;
                    });
                    this.renderer.request();
                };
                el.appendChild(btn);
                this.dom.draggerLayer.appendChild(el);
            }
        }
        renderTaskList(tasks) {
            this.dom.taskList.innerHTML = "";

            const sortedTasks =
                [...tasks].sort(
                    (a, b) =>
                        a.startMinute -
                        b.startMinute
                );

            for (const task of sortedTasks) {
            
                const card = document.createElement("div");
            
                card.className = "taskCard";
            
                card.innerHTML = `
                    <div class="taskCardHeader">
                    
                        <div>
                            <div class="taskCardTitle">
                                ${task.title}
                            </div>
                        
                            <div class="taskCardTime">
                                ${this.minuteToTime(task.startMinute)}
                                -
                                ${this.minuteToTime(task.endMinute)}
                            </div>
                        </div>
                    
                        <div class="taskActions">
                            <button
                                class="editBtn"
                                data-id="${task.id}"
                            >
                                Edit
                            </button>
                        
                            <button
                                class="deleteBtn"
                                data-id="${task.id}"
                            >
                                Delete
                            </button>
                        </div>
                    
                    </div>
                `;
                
                const editBtn = card.querySelector(".editBtn");
                
                const deleteBtn = card.querySelector(".deleteBtn");
                
                editBtn.addEventListener(
                    "click",
                    () => this.editTask(task.id)
                );
                
                deleteBtn.addEventListener(
                    "click",
                    () => this.deleteTask(task.id)
                );
                
                this.dom.taskList.appendChild(card);
            }
        }
        deleteTask(taskId) {

        const state = this.store.get();

        const task =
            state.tasks.find(
                t => t.id === taskId
            );

        if (!task) return;

        this.dom.modalOverlay.classList.remove("hidden");

        document.getElementById("modalTitle").innerText =
            "Delete Task";

        this.dom.modalBoxContent = `
            Delete "${task.title}" ?
        `;

        this.dom.modalSaveBtn.innerText =
            "Delete";

        this.dom.modalSaveBtn.onclick = () => {

            state.tasks =
                state.tasks.filter(
                    t => t.id !== taskId
                );

            this.persistTasks();

            this.renderer.request();

            this.dom.modalOverlay.classList.add("hidden");

            this.dom.modalSaveBtn.innerText =
                "Save";
        };

        this.dom.modalCancelBtn.onclick = () => {
            this.dom.modalOverlay.classList.add("hidden");
        };
    }

    editTask(taskId) {

        const state = this.store.get();

        const task =
            state.tasks.find(
                t => t.id === taskId
            );

        if (!task) return;

        this.dom.modalOverlay.classList.remove("hidden");

        this.dom.modalTaskTitle.value =
            task.title;

        this.dom.modalTaskStart.value =
            this.minuteToTime(task.startMinute);

        this.dom.modalTaskEnd.value =
            this.minuteToTime(task.endMinute);

        const closeModal = () => {
            this.dom.modalOverlay.classList.add("hidden");
        };

        this.dom.modalCancelBtn.onclick =
            closeModal;

        this.dom.modalSaveBtn.onclick = () => {

            const title =
                this.dom.modalTaskTitle.value.trim();

            if (!title) return;

            const startMinute =
                this.timeToMinute(
                    this.dom.modalTaskStart.value
                );

            const endMinute =
                this.timeToMinute(
                    this.dom.modalTaskEnd.value
                );

            if (startMinute >= endMinute) {
                return;
            }

            task.title = title;
            task.startMinute = startMinute;
            task.endMinute = endMinute;

            this.persistTasks();

            this.renderer.request();

            closeModal();
        };
    }
    }
    new App();
