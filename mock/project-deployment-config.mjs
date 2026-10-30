const DEPLOYMENT_CONFIG_PATH = /(?:^|\/)(?:Dockerfile(?:\.[^/]*)?|(?:docker-)?compose(?:\.[^/]*)?\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|Jenkinsfile|Makefile|webpack\.config\.[^/]+|next\.config\.[^/]+|nuxt\.config\.[^/]+|turbo\.json|nx\.json|\.env(?:\.[^/]*)?)$/i;

export const isProjectDeploymentConfigPath = value => typeof value === 'string' && DEPLOYMENT_CONFIG_PATH.test(value);
