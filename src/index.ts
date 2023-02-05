import {getInput, setFailed, debug, setOutput, exportVariable} from "@actions/core";
import { context, getOctokit } from "@actions/github";
import slugify from "@sindresorhus/slugify";
import { execSync } from "child_process";
import { writeFile } from "fs-extra";

const createRobotsTxt = (path: string, robotsContent?: string) =>
  writeFile(
    path,
    robotsContent ||
      `User-agent: *
Disallow: /`
  );

export const run = async () => {
  const token = getInput("token") || process.env.GITHUB_TOKEN;
  const failOnDeployError = getInput("failOnDeployError") || process.env.FAIL_ON_DEPLOY_ERROR;
  if (!token) {
    throw new Error("GitHub token not found");
  }

  if (!context.payload.pull_request && !context.ref) {
    return console.log("Skipped");
  }

  execSync("npm install --global surge");

  const prefix = getInput("prefix") || slugify(`${context.repo.owner}/${context.repo.repo}`);
  const slug = slugify(context.payload.pull_request ? context.payload.pull_request.head.ref : context.ref.replace("refs/heads/", ""));
  const surgeDomain = `${prefix}-${slug}.surge.sh`;
  const robotsTxtPath = getInput("robotsTxtPath");
  const distDir = getInput("distDir");
  const addDeployment = getInput("deploymentEnvironment");
  const octokit = getOctokit(token);

  if (robotsTxtPath)
    await createRobotsTxt(robotsTxtPath, getInput("robotsTxtContent"));

  let deployment: any = undefined;
  if (addDeployment)
    deployment = await octokit.repos.createDeployment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.ref,
      environment: getInput("environmentName") || "Preview",
      production_environment: false,
    });
  console.log("Added deployment");

  if (context.payload.pull_request) {
    const prNumber = context.payload.pull_request.number;

    if (getInput("command") === "teardown") {
      console.log(`Tearing down ${prNumber}`, slug);
      const result = execSync(
        `surge teardown ${prefix}-${slug}.surge.sh`
      ).toString();
      console.log(result);
      return;
    } else console.log(`Deploying ${prNumber}`, slug);

    try {
      const result = execSync(
        `surge --project ${distDir} --domain ${surgeDomain}`
      ).toString();
      console.log(result);
      console.log("Deployed", `https://${surgeDomain}`);
      setOutput('SURGE_DOMAIN', surgeDomain);
      exportVariable('SURGE_DOMAIN', surgeDomain);
      if (addDeployment)
        await octokit.repos.createDeploymentStatus({
          owner: context.repo.owner,
          repo: context.repo.repo,
          deployment_id: (deployment.data as any).id,
          state: "success",
          environment_url: `https://${surgeDomain}`,
          log_url: `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        });
    } catch (error) {
      await logError(error, addDeployment, octokit, deployment, failOnDeployError);
    }

    if (!getInput("skipComment")) {
      const comments = await octokit.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
      });
      const hasComment = !!comments.data.find((comment) =>
        comment.body.includes(
          "This pull request has been automatically deployed."
        )
      );
      if (!hasComment) {
        await octokit.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: prNumber,
          body: `This pull request has been automatically deployed.
✅ Preview: https://${prefix}-${slug}.surge.sh
🔍 Logs: https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        });
        console.log("Added comment to PR");
      } else {
        console.log("PR already has comment");
      }
    }

    if (!getInput("skipLabels"))
      await octokit.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prNumber,
        labels: (getInput("labels") || "deployed")
          .split(",")
          .map((label) => label.trim()),
      });
    console.log("Added label");
  } else if (context.ref) {
    console.log("Deploying commit", slug);
    try {
      const result = execSync(
        `surge --project ${distDir} --domain ${surgeDomain}`
      ).toString();
      console.log(result);
      console.log("Deployed", `https://${surgeDomain}`);
      setOutput('SURGE_DOMAIN', surgeDomain);
      exportVariable('SURGE_DOMAIN', surgeDomain);
      if (addDeployment)
        await octokit.repos.createDeploymentStatus({
          owner: context.repo.owner,
          repo: context.repo.repo,
          deployment_id: (deployment.data as any).id,
          state: "success",
          environment_url: `https://${surgeDomain}`,
          log_url: `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        });
    } catch (error) {
      await logError(error, addDeployment, octokit, deployment, failOnDeployError);
    }
  }
};

const logError = async (error: any, addDeployment: any, octokit: any, deployment: any, failOnDeployError: any) => {
  console.log("ERROR", error.status);
  console.log(error.message);
  console.log(error.stderr.toString());
  console.log(error.stdout.toString());
  if (addDeployment)
    await octokit.repos.createDeploymentStatus({
      owner: context.repo.owner,
      repo: context.repo.repo,
      deployment_id: (deployment.data as any).id,
      state: "error",
    });
  console.log("Added deployment success fail");
  if (failOnDeployError) {
    setFailed("Deployment error");
  }
}

run();
