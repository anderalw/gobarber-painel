import { execFile } from 'child_process';

export interface RunResult {
  ok: boolean;
  output: string;
}

// Roda um comando do Docker e devolve a saída (sem lançar erro: quem chama
// decide o que fazer e guarda o log)
export function docker(
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise(resolve => {
    execFile(
      'docker',
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();

        resolve({ ok: !error, output: error && !output ? error.message : output });
      },
    );
  });
}

// docker compose de um projeto (uma barbearia), com os arquivos da pasta dela
export function compose(
  project: string,
  directory: string,
  args: string[],
  timeoutMs?: number,
): Promise<RunResult> {
  return docker(
    ['compose', '-p', project, '--project-directory', directory, ...args],
    { cwd: directory, timeoutMs },
  );
}

export interface ContainerState {
  service: string;
  state: string;
  health: string;
}

// Situação dos contêineres de todos os projetos, numa chamada só
export async function containersByProject(): Promise<
  Map<string, ContainerState[]>
> {
  const result = await docker(['ps', '-a', '--format', '{{json .}}']);
  const map = new Map<string, ContainerState[]>();

  if (!result.ok) return map;

  result.output
    .split('\n')
    .filter(Boolean)
    .forEach(line => {
      try {
        const item = JSON.parse(line) as {
          Labels: string;
          State: string;
          Status: string;
        };
        const labels = Object.fromEntries(
          item.Labels.split(',').map(pair => {
            const index = pair.indexOf('=');

            return [pair.slice(0, index), pair.slice(index + 1)];
          }),
        );
        const project = labels['com.docker.compose.project'];

        if (!project) return;

        let health = '';

        if (item.Status.includes('(healthy)')) health = 'healthy';
        if (item.Status.includes('(unhealthy)')) health = 'unhealthy';

        map.set(project, [
          ...(map.get(project) || []),
          {
            service: labels['com.docker.compose.service'] || '',
            state: item.State,
            health,
          },
        ]);
      } catch {
        // Linha fora do formato: ignora
      }
    });

  return map;
}

// Garante a rede que o Caddy divide com os sites
export async function ensureNetwork(name: string): Promise<void> {
  const inspect = await docker(['network', 'inspect', name]);

  if (!inspect.ok) await docker(['network', 'create', name]);
}
