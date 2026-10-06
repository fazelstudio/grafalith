import { AppProviders } from './app/providers';
import { editorPath, parseEditorProjectId } from './app/routing/routes';
import { AppShell } from './app/shell/AppShell';
import { HomeScreen } from './features/home/HomeScreen';
import { TrashScreen } from './features/home/TrashScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { EditorScreen } from './features/editor/EditorScreen';

function Routes() {
  return (
    <AppShell>
      {(routeId, navigate, hash) => {
        if (routeId === 'trash') return <TrashScreen />;
        if (routeId === 'editor') {
          const projectId = parseEditorProjectId(hash);
          if (projectId === null) {
            return (
              <HomeScreen
                onOpenProject={(id) => navigate(editorPath(id))}
              />
            );
          }
          return <EditorScreen projectId={projectId} onBackToHome={() => navigate('#/')} />;
        }
        if (routeId === 'settings' || routeId === 'settings-general') {
          return <SettingsScreen section="general" onNavigate={navigate} />;
        }
        if (routeId === 'settings-appearance') {
          return <SettingsScreen section="appearance" onNavigate={navigate} />;
        }
        if (routeId === 'settings-editor') {
          return <SettingsScreen section="editor" onNavigate={navigate} />;
        }
        if (routeId === 'settings-shortcuts') {
          return <SettingsScreen section="shortcuts" onNavigate={navigate} />;
        }
        return <HomeScreen onOpenProject={(id) => navigate(editorPath(id))} />;
      }}
    </AppShell>
  );
}

function App() {
  return (
    <AppProviders>
      <Routes />
    </AppProviders>
  );
}

export default App;
