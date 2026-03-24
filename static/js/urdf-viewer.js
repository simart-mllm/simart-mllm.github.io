
class URDFViewer {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.robot = null;
        this.gui = null;
        this.animationId = null;
        
        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf5f5f5);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(5, 10, 7.5);
        this.scene.add(dirLight);

        // Camera
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(50, aspect, 0.01, 1000);
        this.camera.position.set(1.5, 1.5, 1.5);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Handle resize
        window.addEventListener('resize', () => this.onResize());
        
        // Start animation loop
        this.animate();
    }

    loadURDF(urdfUrl) {
        // Clear previous robot
        if (this.robot) {
            this.scene.remove(this.robot);
            this.robot = null;
        }
        
        // Clear GUI
        if (this.gui) {
            this.gui.destroy();
            this.gui = null;
        }

        const manager = new THREE.LoadingManager();
        manager.onLoad = () => console.log('Loading complete!');
        manager.onProgress = (url, itemsLoaded, itemsTotal) => console.log('Loading file: ' + url + '.\nLoaded ' + itemsLoaded + ' of ' + itemsTotal + ' files.');
        manager.onError = (url) => console.error('There was an error loading ' + url);

        // Try both URDFLoader and THREE.URDFLoader
        let loader;
        
        // Debug info
        console.log('Checking URDFLoader availability:');
        console.log('window.URDFLoader:', typeof window.URDFLoader);
        console.log('THREE.URDFLoader:', typeof THREE.URDFLoader);

        if (typeof window.URDFLoader !== 'undefined') {
            loader = new window.URDFLoader(manager);
        } else if (typeof THREE.URDFLoader !== 'undefined') {
            loader = new THREE.URDFLoader(manager);
        } else {
            console.error('URDFLoader not found. Please check script inclusion.');
            return;
        }
        
        // Ensure OBJLoader is available for mesh loading
        if (typeof THREE.OBJLoader !== 'undefined') {
             console.log('OBJLoader is available, passing to URDFLoader');
             loader.loadMeshCb = function(path, manager, done) {
                const prepareMesh = (mesh) => {
                    mesh.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                    done(mesh);
                };

                if (typeof THREE.MTLLoader !== 'undefined') {
                    // Try to load corresponding material.mtl
                    // Assumption: .obj and .mtl are in the same directory and mtl is named "material.mtl"
                    // or try to infer from obj filename if needed.
                    // Based on user files: box_02_objs/0/0.obj and box_02_objs/0/material.mtl
                    
                    const mtlPath = path.substring(0, path.lastIndexOf('/') + 1) + 'material.mtl';
                    const mtlLoader = new THREE.MTLLoader(manager);
                    
                    // We need to set the path for textures referenced in .mtl
                    mtlLoader.setPath(path.substring(0, path.lastIndexOf('/') + 1));
                    
                    mtlLoader.load('material.mtl', (materials) => {
                        materials.preload();
                        const objLoader = new THREE.OBJLoader(manager);
                        objLoader.setMaterials(materials);
                        objLoader.load(path, prepareMesh, undefined, (err) => {
                             // Fallback if OBJ loading fails with materials
                             console.warn('OBJ with MTL failed, retrying without MTL', err);
                             new THREE.OBJLoader(manager).load(path, prepareMesh);
                        });
                    }, (xhr) => {
                        // Progress
                    }, (err) => {
                        // MTL failed to load, fallback to just OBJ
                        console.warn('MTL not found or failed, loading OBJ only', err);
                        const objLoader = new THREE.OBJLoader(manager);
                        objLoader.load(path, prepareMesh);
                    });
                } else {
                    const objLoader = new THREE.OBJLoader(manager);
                    objLoader.load(path, prepareMesh);
                }
             };
        } else {
            console.error('THREE.OBJLoader is not available!');
        }

        console.log('Starting to load URDF:', urdfUrl);
        // Dispatch start event
        if (this.onLoadStart) this.onLoadStart();

        loader.load(
            urdfUrl, 
            result => {
                console.log('URDF Loaded successfully:', result);
                this.robot = result;
                
                // Rotate robot -90 degrees around X axis
                this.robot.rotation.x = -Math.PI / 2;
                
                this.scene.add(this.robot);
                
                // Center robot
                const box = new THREE.Box3().setFromObject(this.robot);
                const center = box.getCenter(new THREE.Vector3());
                
                // Adjust position to keep it centered after rotation
                // We need to move the robot so its center is at (0,0,0)
                // Since we rotated it, we need to be careful with coordinate systems
                
                // Simplest way: Add to a parent group, center the robot locally, then add group to scene
                // But since we want to rotate the whole thing, let's just adjust position
                
                // Reset position first
                this.robot.position.set(0, 0, 0);
                
                // Re-calculate box after rotation and reset
                const box2 = new THREE.Box3().setFromObject(this.robot);
                const center2 = box2.getCenter(new THREE.Vector3());
                
                this.robot.position.sub(center2);
                
                this.setupGUI();

                // Dispatch complete event
                if (this.onLoadComplete) this.onLoadComplete();
            },
            progress => {
                // console.log('URDF progress:', progress);
            },
            error => {
                console.error('URDF load error:', error);
                if (this.onLoadError) this.onLoadError(error);
            }
        );
    }

    setupGUI() {
        this.gui = new lil.GUI({ container: this.container, width: 260 });
        this.gui.domElement.style.position = 'absolute';
        this.gui.domElement.style.top = '10px';
        this.gui.domElement.style.right = '10px';
        
        // Remove title/header
        const title = this.gui.domElement.querySelector('.title');
        if (title) {
            title.style.display = 'none';
        }

        // Custom UI Styles
        // Yellow rounded background
        this.gui.domElement.style.backgroundColor = 'rgba(255, 235, 59, 0.9)'; // Yellow
        this.gui.domElement.style.borderRadius = '15px';
        this.gui.domElement.style.padding = '10px';
        this.gui.domElement.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';

        // CSS Variables for lil-gui customization
        this.gui.domElement.style.setProperty('--background-color', 'transparent');
        this.gui.domElement.style.setProperty('--text-color', '#333');
        this.gui.domElement.style.setProperty('--widget-color', '#19ae6bff'); // Black slider bg
        this.gui.domElement.style.setProperty('--highlight-color', '#de3d98ff'); // Blue
        this.gui.domElement.style.setProperty('--number-color', '#de3d98ff');
        
        // Enhance slider visibility and font size via injecting CSS
        const styleId = 'lil-gui-custom-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                .lil-gui .controller {
                    margin-bottom: 8px;
                }
                .lil-gui .name {
                    font-size: 14px;
                    font-weight: 600;
                    width: 30% !important;
                }
                .lil-gui .widget {
                    width: 70% !important;
                }
                .lil-gui .slider {
                    height: 24px; /* Taller slider */
                    border-radius: 4px;
                }
                /* The fill bar inside the slider */
                .lil-gui .slider-fg { 
                    background: #2196F3;
                    box-shadow: 0 0 8px #2196F3; /* Glow effect for visibility */
                }
                .lil-gui .display {
                    font-size: 14px;
                    font-weight: bold;
                }
            `;
            document.head.appendChild(style);
        }

        const joints = Object.values(this.robot.joints).filter(j => j.type !== 'fixed');
        
        if (joints.length > 0) {
            joints.forEach(joint => {
                const limitMin = Number(joint.limit.lower);
                const limitMax = Number(joint.limit.upper);
                
                const min = isNaN(limitMin) ? -3.14 : limitMin;
                const max = isNaN(limitMax) ? 3.14 : limitMax;

                const config = { [joint.name]: joint.angle || 0 };
                
                // Format name: j_1 -> joint_1
                const displayName = joint.name.replace('j_', 'joint_');

                this.gui.add(config, joint.name, min, max)
                    .name(displayName)
                    .step(0.01) // Limit to 2 decimal places
                    .onChange(val => {
                        joint.setJointValue(val);
                    });
            });
        }
    }

    onResize() {
        if (!this.renderer || !this.camera) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    destroy() {
        cancelAnimationFrame(this.animationId);
        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }
        if (this.gui) {
            this.gui.destroy();
        }
    }
}

window.URDFViewer = URDFViewer;
