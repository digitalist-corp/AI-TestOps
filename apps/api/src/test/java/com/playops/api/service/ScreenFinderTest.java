package com.playops.api.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class ScreenFinderTest {

    @TempDir
    Path repo;

    private final ScreenFinder finder = new ScreenFinder();

    private void write(String path, String content) throws IOException {
        Path file = repo.resolve(path);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }

    private static Map<String, String> byRoute(ScreenFinder.Result result) {
        return result.screens().stream()
                .collect(Collectors.toMap(ScreenFinder.Screen::routeKey, ScreenFinder.Screen::sourceFile));
    }

    /** AI-TestOps 자신의 apps/web/src/App.tsx 와 같은 모양: 모노레포, 경로 없는 레이아웃 라우트, 리다이렉트, @/ 별칭. */
    @Test
    void findsReactRouterScreensInMonorepoWithNestedLayoutRoute() throws IOException {
        write("package.json", "{\"workspaces\":[\"apps/*\"]}");
        write("apps/web/package.json", "{\"dependencies\":{\"react\":\"19\",\"react-router-dom\":\"7\"}}");
        write("apps/web/src/App.tsx", """
                import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
                import { Layout } from '@/components/Layout';
                import { LoginPage } from '@/pages/LoginPage';
                import { ProjectsPage } from '@/pages/ProjectsPage';
                import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
                import { UsersPage } from '@/pages/UsersPage';

                function ProtectedRoute({ children }: { children: React.ReactNode }) {
                  if (!auth) return <Navigate to="/login" replace />;
                  return <>{children}</>;
                }

                export function App() {
                  return (
                    <BrowserRouter>
                      <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route
                          element={
                            <ProtectedRoute>
                              <Layout />
                            </ProtectedRoute>
                          }
                        >
                          <Route index element={<Navigate to="/projects" replace />} />
                          <Route path="projects" element={<ProjectsPage />} />
                          <Route
                            path="projects/:projectId"
                            element={<Navigate to="dashboard" replace />}
                          />
                          <Route path="projects/:projectId/:tab" element={<ProjectDetailPage />} />
                          <Route path="users" element={<UsersPage />} />
                        </Route>
                        <Route path="*" element={<Navigate to="/projects" replace />} />
                      </Routes>
                    </BrowserRouter>
                  );
                }
                """);
        write("apps/web/src/components/Layout.tsx", "export function Layout() { return null; }");
        for (String page : List.of("LoginPage", "ProjectsPage", "ProjectDetailPage", "UsersPage")) {
            write("apps/web/src/pages/" + page + ".tsx", "export function " + page + "() { return null; }");
        }

        ScreenFinder.Result result = finder.find(repo);

        assertThat(result.framework()).isEqualTo(ScreenFinder.REACT_ROUTER);
        assertThat(result.appRoot()).isEqualTo("apps/web");
        // 경로 없는 레이아웃 라우트 안의 화면은 Layout 이 감싼다. 감싸는 컴포넌트(ProtectedRoute)가 아니라 안쪽의 Layout 이다.
        assertThat(result.screens()).filteredOn(screen -> screen.routeKey().equals("/login"))
                .allSatisfy(screen -> assertThat(screen.layoutFiles()).isEmpty());
        assertThat(result.screens()).filteredOn(screen -> !screen.routeKey().equals("/login"))
                .allSatisfy(screen -> assertThat(screen.layoutFiles()).containsExactly("apps/web/src/components/Layout.tsx"));
        assertThat(byRoute(result)).containsExactlyInAnyOrderEntriesOf(Map.of(
                "/login", "apps/web/src/pages/LoginPage.tsx",
                "/projects", "apps/web/src/pages/ProjectsPage.tsx",
                "/projects/:projectId/:tab", "apps/web/src/pages/ProjectDetailPage.tsx",
                "/users", "apps/web/src/pages/UsersPage.tsx"));
    }

    @Test
    void picksInnermostComponentAndResolvesLazyAndRelativeImports() throws IOException {
        write("package.json", "{\"dependencies\":{\"react-router-dom\":\"6\"}}");
        write("src/routes.jsx", """
                import React, { lazy } from 'react';
                import Home from './screens/Home';
                const Settings = lazy(() => import('./screens/settings'));
                export const routes = (
                  <Routes>
                    <Route path="/" element={<Shell />}>
                      <Route index element={<Guard role="user"><Home /></Guard>} />
                      <Route path='settings' Component={Settings} />
                    </Route>
                  </Routes>
                );
                """);
        write("src/screens/Home.jsx", "export default function Home() { return null; }");
        write("src/screens/settings/index.jsx", "export default function Settings() { return null; }");

        assertThat(byRoute(finder.find(repo))).containsExactlyInAnyOrderEntriesOf(Map.of(
                "/", "src/screens/Home.jsx",
                "/settings", "src/screens/settings/index.jsx"));
    }

    /** React Router v5 이하: 진입 파일이 "/" 에 껍데기(App)를 걸고, App 안에서 다시 "/" 를 실제 화면에 건다. */
    @Test
    void prefersRealScreenOverRouterShellWhenSamePathIsDefinedTwice() throws IOException {
        write("package.json", "{\"dependencies\":{\"react-router-dom\":\"4\"}}");
        write("src/index.js", """
                import App from './components/App';
                ReactDOM.render(<Router><Switch><Route path="/" component={App} /></Switch></Router>, root);
                """);
        write("src/components/App.js", """
                import Home from '../components/Home';
                import Login from '../components/Login';
                export default () => (
                  <Switch>
                    <Route exact path="/" component={Home}/>
                    <Route path="/login" component={Login} />
                  </Switch>
                );
                """);
        write("src/components/Home/index.js", "export default () => null;");
        write("src/components/Login.js", "export default () => null;");

        assertThat(byRoute(finder.find(repo))).containsExactlyInAnyOrderEntriesOf(Map.of(
                "/", "src/components/Home/index.js",
                "/login", "src/components/Login.js"));
    }

    @Test
    void findsNextAppRouterScreens() throws IOException {
        write("package.json", "{\"dependencies\":{\"next\":\"15\",\"react\":\"19\"}}");
        write("app/page.tsx", "");
        write("app/layout.tsx", "");
        write("app/(shop)/products/[id]/page.tsx", "");
        write("app/(shop)/layout.tsx", "");
        write("app/blog/[...slug]/page.tsx", "");
        write("app/_private/page.tsx", "");
        write("app/api/health/route.ts", "");
        write("node_modules/some/app/page.tsx", "");

        ScreenFinder.Result result = finder.find(repo);

        assertThat(result.framework()).isEqualTo(ScreenFinder.NEXT);
        assertThat(result.screens()).filteredOn(screen -> screen.routeKey().equals("/products/:id"))
                .allSatisfy(screen -> assertThat(screen.layoutFiles())
                        .containsExactly("app/layout.tsx", "app/(shop)/layout.tsx"));
        assertThat(byRoute(result)).containsExactlyInAnyOrderEntriesOf(Map.of(
                "/", "app/page.tsx",
                "/products/:id", "app/(shop)/products/[id]/page.tsx",
                "/blog/:slug*", "app/blog/[...slug]/page.tsx"));
    }

    @Test
    void findsNextPagesRouterScreens() throws IOException {
        write("package.json", "{\"dependencies\":{\"next\":\"13\"}}");
        write("src/pages/index.tsx", "");
        write("src/pages/about.tsx", "");
        write("src/pages/posts/[id].tsx", "");
        write("src/pages/posts/index.tsx", "");
        write("src/pages/_app.tsx", "");
        write("src/pages/api/hello.ts", "");

        assertThat(byRoute(finder.find(repo)).keySet())
                .containsExactlyInAnyOrder("/", "/about", "/posts/:id", "/posts");
    }

    @Test
    void reportsUnsupportedProjectInsteadOfGuessing() throws IOException {
        write("package.json", "{\"dependencies\":{\"vue\":\"3\",\"vue-router\":\"4\"}}");
        write("src/router.js", "export default []");

        ScreenFinder.Result result = finder.find(repo);

        assertThat(result.framework()).isNull();
        assertThat(result.screens()).isEmpty();
        assertThat(result.warnings()).anyMatch(w -> w.contains("지원"));
    }

    @Test
    void doesNotFollowSymlinksOutOfTheRepository(@TempDir Path outside) throws IOException {
        write("package.json", "{\"dependencies\":{\"next\":\"15\"}}");
        write("app/page.tsx", "");
        Files.createDirectories(outside.resolve("secret"));
        Files.writeString(outside.resolve("secret/page.tsx"), "");
        Files.createSymbolicLink(repo.resolve("app/linked"), outside.resolve("secret"));

        assertThat(byRoute(finder.find(repo)).keySet()).containsExactly("/");
    }
}
