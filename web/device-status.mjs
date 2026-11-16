// Keep the device's operational status independent of its disk image label.
export const deviceStatusLabel = node => node.status === 'running' ? '● Запущен' : node.status === 'error' ? '● Ошибка' : '● Остановлен';
export const deviceStatusStyle = node => node.status === 'running' ? 'up' : node.status === 'error' ? 'error' : 'stopped';
