const DEPLOYMENT_CONFIG_PATH = /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|(?:docker-)?compose(?:\.[^/]*)?\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|Jenkinsfile|Makefile|webpack\.config\.[^/]+|next\.config\.[^/]+|nuxt\.config\.[^/]+|turbo\.json|nx\.json|\.env(?:\.[^/]*)?)$/i;
const ADDITIONAL_DEPLOYMENT_CONFIG_PATH = /(?:^|\/)(?:Procfile|vercel\.json|netlify\.toml|fly\.toml|render\.ya?ml|railway\.json|serverless\.ya?ml|wrangler\.toml|app\.ya?ml)$/i;

export const isProjectDeploymentConfigPath = value => typeof value === 'string' && DEPLOYMENT_CONFIG_PATH.test(value);
export const isProjectDeploymentConfigPathV37 = value => isProjectDeploymentConfigPath(value) || typeof value === 'string' && ADDITIONAL_DEPLOYMENT_CONFIG_PATH.test(value);
