const PAGES=[["index","Inicio"],["componentes","Componentes"],["funcionalidades","Funcionalidades"],["ejercicios","Ejercicios"],["recursos","Recursos"]];
const COMPONENTES=[
{id:"cpu",n:"Procesador (CPU)",inst:"1x Intel Xeon Silver 4210R · 10 núcleos / 20 hilos",lim:"20 vCPUs totales; 2 reservados para Proxmox → 18 útiles",uso:"Ejecuta el cómputo de todas las VMs y contenedores. Cada vCPU es un hilo que el hipervisor reparte entre las máquinas virtuales.",nota:"Se pueden sobre-asignar vCPUs, pero demasiada contención degrada el rendimiento de Producción."},
{id:"ram",n:"Memoria RAM",inst:"64 GB DDR4 ECC Registered (2 x 32 GB)",lim:"6 GB para kernel PVE y ZFS ARC → 58 GB netos",uso:"Almacena los datos activos de cada VM/LXC. ECC detecta y corrige errores de bits: clave en servidores. Es el cuello de botella principal del Lab 302.",nota:"La placa monoprocesador soporta hasta 768 GB. Plan: 4 módulos de 32 GB → 192 GB."},
{id:"disco",n:"Almacenamiento (ZFS)",inst:"2x SSD Enterprise SATA 960 GB en ZFS Mirror (RAID 1)",lim:"890 GB netos; con 20% libre de reserva → 712 GB útiles",uso:"Guarda discos de VMs, contenedores, snapshots y backups locales. ZFS aporta Copy-on-Write, snapshots instantáneos y checksums. El mirror tolera la falla de un disco.",nota:"Pasar del 80% de ocupación fragmenta el pool y desploma los IOPS."},
{id:"red",n:"Red física",inst:"4x 1GbE RJ45 + 2x 10GbE SFP+",lim:"Linux Bridges VLAN Aware (vmbr0)",uso:"Conecta el servidor con la universidad. Un bridge VLAN Aware transporta varias VLANs (802.1Q) por una sola interfaz: Producción en VLAN 10, laboratorios en VLAN 20-23.",nota:"Los puertos 10GbE serán necesarios para almacenamiento compartido y migración en vivo en un clúster."},
{id:"hipervisor",n:"Hipervisor Proxmox VE",inst:"Proxmox VE (Tipo 1, bare-metal sobre kernel Linux)",lim:"Nodo único: sin clúster, sin HA",uso:"Capa de software que reparte el hardware. Ofrece interfaz web, CLI (qm, pct, pveum), API REST, roles, pools, backups y snapshots.",nota:"Al correr directo sobre el hardware, tiene menos overhead que un Tipo 2 como VirtualBox."},
{id:"virt",n:"Virtualización: KVM vs LXC",inst:"KVM = máquinas virtuales · LXC = contenedores",lim:"LXC: ~50-100 MB RAM base por contenedor",uso:"KVM virtualiza hardware completo y kernel propio (Linux o Windows): ideal para Producción. LXC comparte el kernel del host: ligero, ideal para 25 instancias de alumnos.",nota:"Regla: aislamiento total → KVM; alta densidad → LXC."}];
const ENTORNOS=[["Producción","KVM","6","16 GB","250 GB","Moodle, BD y DNS. Prioridad máxima, sin SWAP."],["Laboratorios","LXC / KVM","8","24 GB","250 GB","4 pools docentes, hasta 25 instancias de alumnos."],["Desarrollo","LXC","4","10 GB","120 GB","Tesis y proyectos. Ballooning y snapshots locales."],["Pruebas","LXC efímeros","2","8 GB","92 GB","Sandbox; I/O limitado (cgroups) y purga nocturna."]];
const FUNCIONES=[
{id:"pools",n:"Resource Pools y RBAC",ok:1,que:"Agrupan VMs/LXC y permiten dar permisos por grupo. Cada docente ve solo su pool (Pool_Lab_Prof1 … Prof4).",pasos:["Crear el pool","Crear el rol restringido","Asignar usuario al pool con ese rol"],cmd:`pveum pool add Pool_Lab_Prof1
pveum role add Profesor_Admin -privs "VM.PowerMgmt VM.Console VM.Snapshot"
pveum acl modify /pool/Pool_Lab_Prof1 --users prof1@pve --roles Profesor_Admin`},
{id:"clone",n:"Clonado y creación de máquinas",ok:1,que:"Crea VMs (qm) y contenedores (pct) rápido; los clones vinculados comparten disco base y se crean en segundos.",pasos:["Preparar una plantilla","Clonar por alumno","Crear un LXC en una VLAN de laboratorio"],cmd:`qm clone 9000 101 --name alumno01
pct create 1001 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \\
  --hostname lab-a01 --memory 512 --cores 1 \\
  --net0 name=eth0,bridge=vmbr0,tag=20 --pool Pool_Lab_Prof1`},
{id:"snap",n:"Snapshots",ok:1,que:"Puntos de restauración instantáneos sobre ZFS (Copy-on-Write). Sirven para revertir una actualización fallida; vida máxima 48-72 h. NO son backups: viven en el mismo pool.",pasos:["Tomar snapshot antes de cambiar algo","Revertir si falla","Eliminarlo al terminar"],cmd:`qm snapshot 101 antes-update
qm rollback 101 antes-update
qm delsnapshot 101 antes-update`},
{id:"backup",n:"Backups (VZDump / PBS)",ok:1,que:"Copias completas e independientes. Producción: diario 02:00 AM en modo snapshot (sin apagar). Objetivo RPO ≤ 24 h y RTO ≤ 2 h.",pasos:["Respaldar una VM en caliente","Restaurar desde el archivo"],cmd:`vzdump 100 --mode snapshot --storage backup --compress zstd
qmrestore /mnt/backup/dump/vzdump-qemu-100.vma.zst 100`},
{id:"vlan",n:"VLANs (VLAN Aware)",ok:1,que:"Aísla el tráfico por entorno en un solo bridge. Se activa vmbr0 como VLAN Aware y cada VM recibe su tag.",pasos:["Activar VLAN Aware en vmbr0","Asignar tag a una VM"],cmd:`# /etc/network/interfaces  (dentro de vmbr0)
    bridge-vlan-aware yes
    bridge-vids 2-4094
qm set 101 --net0 virtio,bridge=vmbr0,tag=20`},
{id:"agent",n:"qemu-guest-agent",ok:1,que:"Comunicación hipervisor ↔ sistema invitado: apagado limpio, hora sincronizada, fs-freeze en backups y reporte real de red/RAM.",pasos:["Habilitar en Proxmox","Instalar dentro de la VM"],cmd:`qm set 101 --agent enabled=1
# dentro de la VM (Debian/Ubuntu):
apt install qemu-guest-agent && systemctl enable --now qemu-guest-agent`},
{id:"api",n:"API REST y automatización",ok:1,que:"Todo lo de la interfaz web también se hace por HTTP. Casos del proyecto: clonar desde Moodle y purgar el entorno de Pruebas a las 03:00 AM con control Fail-Safe.",pasos:["Listar contenedores","Clonar","Apagar y purgar (solo si pool = Pool_Pruebas y tag #efimero)"],cmd:`H="Authorization: PVEAPIToken=usuario@pve!token=SECRETO"
curl -k -H "$H" https://IP:8006/api2/json/nodes/lab-302/lxc
curl -k -H "$H" -X POST -d "newid=2001" https://IP:8006/api2/json/nodes/lab-302/lxc/1000/clone
curl -k -H "$H" -X POST https://IP:8006/api2/json/nodes/lab-302/lxc/2001/status/stop
curl -k -H "$H" -X DELETE "https://IP:8006/api2/json/nodes/lab-302/lxc/2001?purge=1"`},
{id:"cluster",n:"Clúster, Quorum, Live Migration y HA",ok:0,que:"NO operan en el servidor actual (nodo único). Requieren mínimo 3 nodos (o 2 + QDevice) para Quorum vía Corosync; Live Migration y HA exigen además almacenamiento compartido (Ceph/SAN/NFS) y red 10GbE.",pasos:["Concepto para el examen: no se practica en el Lab 302"],cmd:`# Referencia (futuro clúster):
pvecm create mi-cluster      # primer nodo
pvecm add IP_NODO1           # nodos siguientes
pvecm status                 # ver Quorum`}];
const TEORIA=[
["Diferencia entre virtualización Tipo 1 y Tipo 2; ¿por qué Proxmox es Tipo 1?","Corre directo sobre el hardware (bare-metal) con un kernel Linux optimizado, sin SO anfitrión intermedio: menos overhead y mejor I/O que un Tipo 2 (ej. VirtualBox)."],
["¿Por qué LXC para laboratorios masivos y KVM para Producción?","LXC comparte el kernel del host (~50-100 MB RAM base) y permite alta densidad. KVM virtualiza hardware completo con kernel propio (o Windows): aislamiento total."],
["¿Por qué un Snapshot no es un Backup?","Reside en el mismo pool físico que la VM. Si falla el arreglo o la controladora, se pierden la VM y sus snapshots."],
["¿Para qué la regla del 20% libre en ZFS?","ZFS necesita bloques contiguos libres para Copy-on-Write. Sobre 80% de ocupación se fragmenta y caen los IOPS."],
["¿Qué es el Quorum y cuántos nodos requiere?","Número mínimo de votos activos (Corosync) para decidir en el clúster. Mínimo 3 nodos, o 2 + QDevice, para evitar Split-Brain."],
["¿Por qué no hay Live Migration en el Lab 302?","Requiere sincronizar RAM en tiempo real y almacenamiento compartido (Ceph, NFS, SAN) por red dedicada de alta velocidad; hay un solo nodo."],
["¿Cómo garantizan los Resource Pools la seguridad entre docentes?","Aíslan la visibilidad y gestión: un docente con rol restringido en Pool_Lab_Prof1 no ve, modifica ni apaga instancias ajenas ni de Producción."],
["¿Función de 'VLAN Aware' en vmbr0?","Permite que una interfaz transporte tráfico etiquetado 802.1Q de varias VLANs, aislando broadcast de Producción (VLAN 10) y laboratorios (VLAN 20-23)."],
["¿Para qué sirve qemu-guest-agent?","Comunicación hipervisor-invitado: cierres limpios, sincronización de hora, fs-freeze durante backups y reporte real de red/RAM."],
["¿Cómo previene el control Fail-Safe borrar un servidor crítico?","Valida en código que pool == 'Pool_Pruebas' y exista el tag '#efimero' antes del DELETE; si detecta Producción, aborta."]];
const CALCULO=[
["RAM neta para VMs/LXC con 64 GB si el kernel PVE y ZFS ARC usan 6 GB (en GB).",58],
["vCPUs útiles de 20 hilos si se reservan 2 para Proxmox.",18],
["Disco útil (GB) de 890 GB netos reservando el 20% libre en ZFS (redondea al entero).",712],
["RAM neta (GB) tras ampliar a 192 GB, con los mismos 6 GB de overhead.",186],
["Presupuesto (USD): 4 módulos RAM de $140 + 2 SSD NVMe de $280.",1120],
["¿Cuántas veces aumenta la RAM total al pasar de 64 a 192 GB?",3],
["vCPUs asignadas a los 4 entornos (6+8+4+2) menos las 18 útiles. ¿Cuántas sobran o faltan? (negativo = faltan)",-2]];
const PRACTICA=[
["Clona la plantilla 9000 como VM 105 llamada 'alumno05'.","qm clone 9000 105 --name alumno05"],
["Crea el LXC 1010 'lab-b02' con 512 MB, 1 núcleo, bridge vmbr0 y VLAN 21 desde la plantilla debian-12.","pct create 1010 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst --hostname lab-b02 --memory 512 --cores 1 --net0 name=eth0,bridge=vmbr0,tag=21"],
["Toma un snapshot 'pre-upgrade' de la VM 101 y luego revierte.","qm snapshot 101 pre-upgrade\nqm rollback 101 pre-upgrade"],
["Respalda la VM 100 en caliente al storage 'backup'.","vzdump 100 --mode snapshot --storage backup"],
["Crea el pool Pool_Lab_Prof2 y da al usuario prof2@pve el rol Profesor_Admin sobre él.","pveum pool add Pool_Lab_Prof2\npveum acl modify /pool/Pool_Lab_Prof2 --users prof2@pve --roles Profesor_Admin"],
["Habilita el guest agent en la VM 101.","qm set 101 --agent enabled=1"]];
const RECURSOS=[["Documentación oficial Proxmox VE","https://pve.proxmox.com/pve-docs/","Manual completo: instalación, storage, red, backups."],["Wiki de Proxmox VE","https://pve.proxmox.com/wiki/Main_Page","Guías y how-tos."],["Visor de la API REST","https://pve.proxmox.com/pve-docs/api-viewer/","Endpoints /api2/json documentados."],["Proxmox Backup Server","https://www.proxmox.com/en/products/proxmox-backup-server/overview","Backups deduplicados e incrementales."],["Manual de qm (VMs)","https://pve.proxmox.com/pve-docs/qm.1.html","Opciones del comando qm."],["Manual de pct (LXC)","https://pve.proxmox.com/pve-docs/pct.1.html","Opciones del comando pct."],["Documentación OpenZFS","https://openzfs.github.io/openzfs-docs/","Copy-on-Write, ARC, mirrors, snapshots."],["Universidad Privada Franz Tamayo","https://unifranz.edu.bo/","Sitio institucional."]];
