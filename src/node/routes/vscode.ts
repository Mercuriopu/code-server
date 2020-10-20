import { Router } from "express"
import { promises as fs } from "fs"
import * as path from "path"
import { DefaultedArgs } from "../cli"
import { commit, rootPath, version } from "../constants"
import { asyncRoute, asyncWsRoute, authenticated, ensureAuthenticated, redirect, replaceTemplates } from "../http"
import { memo, pathToFsPath } from "../util"
import { VscodeProvider } from "../vscode"

const router = Router()

const route = (args: DefaultedArgs): Router => {
  const vscode = new VscodeProvider(args)

  router.get(
    "/",
    asyncRoute(async (req, res) => {
      if (!authenticated(args.auth, req, args.password)) {
        return redirect(req, res, "login", {
          to: req.baseUrl || "/",
        })
      }

      const [content, options] = await Promise.all([
        await fs.readFile(path.join(rootPath, "src/browser/pages/vscode.html"), "utf8"),
        vscode
          .initialize(
            {
              args,
              remoteAuthority: req.headers.host || "",
            },
            req.query,
          )
          .catch((error) => {
            const devMessage = commit === "development" ? "It might not have finished compiling." : ""
            throw new Error(`VS Code failed to load. ${devMessage} ${error.message}`)
          }),
      ])

      options.productConfiguration.codeServerVersion = version

      res.send(
        replaceTemplates(
          req,
          // Uncomment prod blocks if not in development. TODO: Would this be
          // better as a build step? Or maintain two HTML files again?
          commit !== "development" ? content.replace(/<!-- PROD_ONLY/g, "").replace(/END_PROD_ONLY -->/g, "") : content,
          {
            disableTelemetry: !!args["disable-telemetry"],
          },
        )
          .replace(`"{{REMOTE_USER_DATA_URI}}"`, `'${JSON.stringify(options.remoteUserDataUri)}'`)
          .replace(`"{{PRODUCT_CONFIGURATION}}"`, `'${JSON.stringify(options.productConfiguration)}'`)
          .replace(`"{{WORKBENCH_WEB_CONFIGURATION}}"`, `'${JSON.stringify(options.workbenchWebConfiguration)}'`)
          .replace(`"{{NLS_CONFIGURATION}}"`, `'${JSON.stringify(options.nlsConfiguration)}'`),
      )
    }),
  )

  router.ws(
    "/",
    asyncWsRoute(async (ws, req) => {
      ensureAuthenticated(args.auth, req, args.password)
      // Since this socket is sent to a child process we need the underlying
      // socket. VS Code also handles the frames so using the ws wrapper might
      // cause issues there.
      await vscode.sendWebsocket((ws as any)._socket, req.query)
    }),
  )

  router.get(
    "/resource",
    asyncRoute(async (req, res) => {
      ensureAuthenticated(args.auth, req, args.password)
      if (typeof req.query.path === "string") {
        res.send(await fs.readFile(pathToFsPath(req.query.path)))
      }
    }),
  )

  router.get(
    "/vscode-remote-resource",
    asyncRoute(async (req, res) => {
      ensureAuthenticated(args.auth, req, args.password)
      if (typeof req.query.path === "string") {
        res.send(await fs.readFile(pathToFsPath(req.query.path)))
      }
    }),
  )

  router.get(
    "/webview",
    asyncRoute(async (req, res) => {
      ensureAuthenticated(args.auth, req, args.password)
      if (/^\/vscode-resource/.test(req.path)) {
        return res.send(await fs.readFile(req.path.replace(/^\/vscode-resource(\/file)?/, "")))
      }
      return res.send(
        await fs.readFile(path.join(vscode.vsRootPath, "out/vs/workbench/contrib/webview/browser/pre", req.path)),
      )
    }),
  )

  return router
}

export = memo(route)
