const DEPLOYMENT_CONFIG_PATH = /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|(?:docker-)?compose(?:\.[^/]*)?\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|Jenkinsfile|Makefile|webpack\.config\.[^/]+|next\.config\.[^/]+|nuxt\.config\.[^/]+|turbo\.json|nx\.json|\.env(?:\.[^/]*)?)$/i;
const ADDITIONAL_DEPLOYMENT_CONFIG_PATH = /(?:^|\/)(?:Procfile|vercel\.json|netlify\.toml|fly\.toml|render\.ya?ml|railway\.json|serverless\.ya?ml|wrangler\.toml|app\.ya?ml)$/i;
const PYTHON_DEPENDENCY_CONFIG_PATH = /(?:^|\/)(?:Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|pdm\.lock|pylock\.toml|environment\.ya?ml|conda-lock\.ya?ml|requirements(?:[-_.][^/]*)?\.(?:txt|in)|constraints(?:[-_.][^/]*)?\.txt|requirements\/[^/]+\.(?:txt|in))$/i;

export const isProjectDeploymentConfigPath = value => typeof value === 'string' && DEPLOYMENT_CONFIG_PATH.test(value);
export const isProjectDeploymentConfigPathV37 = value => isProjectDeploymentConfigPath(value) || typeof value === 'string' && ADDITIONAL_DEPLOYMENT_CONFIG_PATH.test(value);
export const isProjectPythonDependencyConfigPathV38 = value => typeof value === 'string' && PYTHON_DEPENDENCY_CONFIG_PATH.test(value);
