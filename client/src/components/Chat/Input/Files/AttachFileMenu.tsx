import React, { useRef, useState, useMemo, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import * as Ariakit from '@ariakit/react';
import {
  FileSearch,
  ImageUpIcon,
  FileType2Icon,
  FileImageIcon,
  TerminalSquareIcon,
  FileUp,
  Clock,
} from 'lucide-react';
import {
  OGDialog,
  FileUpload,
  TooltipAnchor,
  DropdownPopup,
  AttachmentIcon,
  SharePointIcon,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import {
  Providers,
  EToolResources,
  EModelEndpoint,
  defaultAgentCapabilities,
  bedrockDocumentExtensions,
  isDocumentSupportedProvider,
  type TFile,
} from 'librechat-data-provider';
import type { EndpointFileConfig } from 'librechat-data-provider';
import {
  useAgentToolPermissions,
  useAgentCapabilities,
  useGetAgentsConfig,
  useFileHandling,
  useLocalize,
  useUpdateFiles,
} from '~/hooks';
import useSharePointFileHandling from '~/hooks/Files/useSharePointFileHandling';
import { SharePointPickerDialog } from '~/components/SharePoint';
import { useGetFiles, useGetStartupConfig } from '~/data-provider';
import { useChatContext, useFileMapContext } from '~/Providers';
import { ephemeralAgentByConvoId } from '~/store';
import { MenuItemProps } from '~/common';
import { cn } from '~/utils';

type FileUploadType =
  | 'image'
  | 'document'
  | 'image_document'
  | 'image_document_extended'
  | 'image_document_video_audio';

interface AttachFileMenuProps {
  agentId?: string | null;
  endpoint?: string | null;
  disabled?: boolean | null;
  conversationId: string;
  endpointType?: EModelEndpoint | string;
  endpointFileConfig?: EndpointFileConfig;
  useResponsesApi?: boolean;
}

const AttachFileMenu = ({
  agentId,
  endpoint,
  disabled,
  endpointType,
  conversationId,
  endpointFileConfig,
  useResponsesApi,
}: AttachFileMenuProps) => {
  const localize = useLocalize();
  const isUploadDisabled = disabled ?? false;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId),
  );
  const [toolResource, setToolResource] = useState<EToolResources | undefined>();
  const { handleFileChange } = useFileHandling();
  const { handleSharePointFiles, isProcessing, downloadProgress } = useSharePointFileHandling();

  const { agentsConfig } = useGetAgentsConfig();
  const { data: startupConfig } = useGetStartupConfig();
  const sharePointEnabled = startupConfig?.sharePointFilePickerEnabled;

  const { data: allFiles = [] } = useGetFiles();
  const { setFiles } = useChatContext();
  const { addFile } = useUpdateFiles(setFiles);
  const fileMap = useFileMapContext();
  const { showToast } = useToastContext();

  const [isSharePointDialogOpen, setIsSharePointDialogOpen] = useState(false);
  const [pendingSharePointFiles, setPendingSharePointFiles] = useState<any[]>([]);
  const [showSharePointUploadModal, setShowSharePointUploadModal] = useState(false);

  /** TODO: Ephemeral Agent Capabilities
   * Allow defining agent capabilities on a per-endpoint basis
   * Use definition for agents endpoint for ephemeral agents
   * */
  const capabilities = useAgentCapabilities(agentsConfig?.capabilities ?? defaultAgentCapabilities);

  const { fileSearchAllowedByAgent, codeAllowedByAgent, providerUploadAllowedByAgent, provider } =
    useAgentToolPermissions(agentId, ephemeralAgent);

  const handleUploadClick = (fileType?: FileUploadType) => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = '';
    if (fileType === 'image') {
      inputRef.current.accept = 'image/*,.heif,.heic';
    } else if (fileType === 'document') {
      inputRef.current.accept = '.pdf,application/pdf';
    } else if (fileType === 'image_document') {
      inputRef.current.accept = 'image/*,.heif,.heic,.pdf,application/pdf';
    } else if (fileType === 'image_document_extended') {
      inputRef.current.accept = `image/*,.heif,.heic,${bedrockDocumentExtensions}`;
    } else if (fileType === 'image_document_video_audio') {
      inputRef.current.accept = 'image/*,.heif,.heic,.pdf,application/pdf,video/*,audio/*';
    } else {
      inputRef.current.accept = '';
    }
    inputRef.current.click();
    inputRef.current.accept = '';
  };

  // Smart upload handler that routes based on file type
  const handleSmartUpload = useCallback(() => {
    if (!inputRef.current) {
      return;
    }

    // Clear input and accept filter
    inputRef.current.value = '';
    inputRef.current.accept = '';

    // Remove any existing listener to prevent duplicates
    const existingListener = (inputRef.current as any)._smartUploadHandler;
    if (existingListener) {
      inputRef.current.removeEventListener('change', existingListener);
    }

    // Create handler to detect file type after selection
    const smartUploadHandler = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];

      if (!file) {
        return;
      }

      // Check if file is an image by checking if mimetype starts with 'image'
      const isImage = file.type.startsWith('image');
      setToolResource(isImage ? undefined : EToolResources.context);

      // Trigger file change handler
      handleFileChange(event as any, isImage ? undefined : EToolResources.context);
      input.removeEventListener('change', smartUploadHandler);
      delete (input as any)._smartUploadHandler;
    };

    // Store reference for cleanup
    (inputRef.current as any)._smartUploadHandler = smartUploadHandler;
    inputRef.current.addEventListener('change', smartUploadHandler);

    // Trigger file picker
    inputRef.current.click();
  }, [handleFileChange, setToolResource]);

  const sharePointUploadOptions = useMemo(() => {
    type SharePointUploadOption = {
      label: string;
      value: EToolResources | undefined;
      icon: React.JSX.Element;
    };
    const options: SharePointUploadOption[] = [];

    let currentProvider = provider || endpoint;
    if (currentProvider?.toLowerCase() === Providers.OPENROUTER) {
      currentProvider = Providers.OPENROUTER;
    }

    const isAzureWithResponsesApi =
      currentProvider === EModelEndpoint.azureOpenAI && useResponsesApi;

    if (
      isDocumentSupportedProvider(endpointType) ||
      isDocumentSupportedProvider(currentProvider) ||
      isAzureWithResponsesApi
    ) {
      options.push({
        label: localize('com_ui_upload_provider'),
        value: undefined,
        icon: <FileImageIcon className="icon-md" />,
      });
    }

    if (capabilities.contextEnabled) {
      options.push({
        label: localize('com_ui_upload_file'),
        value: EToolResources.context,
        icon: <FileType2Icon className="icon-md" />,
      });
    }

    if (capabilities.fileSearchEnabled && fileSearchAllowedByAgent) {
      options.push({
        label: localize('com_ui_upload_file_search'),
        value: EToolResources.file_search,
        icon: <FileSearch className="icon-md" />,
      });
    }

    if (capabilities.codeEnabled && codeAllowedByAgent) {
      options.push({
        label: localize('com_ui_upload_code_files'),
        value: EToolResources.execute_code,
        icon: <TerminalSquareIcon className="icon-md" />,
      });
    }

    return options;
  }, [
    localize,
    provider,
    endpoint,
    endpointType,
    capabilities,
    useResponsesApi,
    fileSearchAllowedByAgent,
    codeAllowedByAgent,
  ]);

  const dropdownItems = useMemo(() => {
    const handleAttachExistingFile = (file: TFile) => {
      // Basic validation: Check if file exists in fileMap
      if (!fileMap?.[file.file_id]) {
        showToast({
          message: localize('com_ui_attach_error'),
          status: 'error',
        });
        return;
      }

      const fileData = fileMap[file.file_id];

      // Determine tool resource based on file type
      const isImage = file.type.startsWith('image');
      const toolRes = isImage ? undefined : EToolResources.context;

      // Set the tool resource
      setToolResource(toolRes);

      // Add the file to the conversation
      addFile({
        progress: 1,
        attached: true,
        file_id: fileData.file_id,
        filepath: fileData.filepath,
        preview: fileData.filepath,
        type: fileData.type,
        height: fileData.height,
        width: fileData.width,
        filename: fileData.filename,
        source: fileData.source,
        size: fileData.bytes,
        metadata: fileData.metadata,
      });

      // Close the menu
      setIsPopoverActive(false);
    };

    // Get recent files (last 10, sorted by createdAt)
    const recentFiles = Array.isArray(allFiles)
      ? [...allFiles]
          .filter((file) => file.createdAt)
          .sort((a, b) => {
            const dateA = new Date(a.createdAt!).getTime();
            const dateB = new Date(b.createdAt!).getTime();
            return dateB - dateA; // Most recent first
          })
          .slice(0, 10)
      : [];

    const createMenuItems = (onAction: (fileType?: FileUploadType) => void) => {
      const items: MenuItemProps[] = [];

      let currentProvider = provider || endpoint;

      // This will be removed in a future PR to formally normalize Providers comparisons to be case insensitive
      if (currentProvider?.toLowerCase() === Providers.OPENROUTER) {
        currentProvider = Providers.OPENROUTER;
      }

      const isAzureWithResponsesApi =
        currentProvider === EModelEndpoint.azureOpenAI && useResponsesApi;

      if (
        providerUploadAllowedByAgent &&
        (isDocumentSupportedProvider(endpointType) ||
          isDocumentSupportedProvider(currentProvider) ||
          isAzureWithResponsesApi)
      ) {
        items.push({
          label: localize('com_ui_upload_provider'),
          onClick: () => {
            setToolResource(undefined);
            let fileType: Exclude<FileUploadType, 'image' | 'document'> = 'image_document';
            if (currentProvider === Providers.GOOGLE || currentProvider === Providers.OPENROUTER) {
              fileType = 'image_document_video_audio';
            } else if (
              currentProvider === Providers.BEDROCK ||
              endpointType === EModelEndpoint.bedrock
            ) {
              fileType = 'image_document_extended';
            }
            onAction(fileType);
          },
          icon: <FileImageIcon className="icon-md" />,
        });
      }
      /*else {
        items.push({
          label: localize('com_ui_upload_image_input'),
          onClick: () => {
            setToolResource(undefined);
            onAction('image');
          },
          icon: <ImageUpIcon className="icon-md" />,
        });
      }*/

      if (capabilities.contextEnabled) {
        items.push({
          label: localize('com_ui_upload_file'),
          onClick: handleSmartUpload,
          icon: <FileType2Icon className="icon-md" />,
        });
      }

      if (capabilities.fileSearchEnabled && fileSearchAllowedByAgent) {
        items.push({
          label: localize('com_ui_upload_file_search'),
          onClick: () => {
            setToolResource(EToolResources.file_search);
            setEphemeralAgent((prev) => ({
              ...prev,
              [EToolResources.file_search]: true,
            }));
            onAction();
          },
          icon: <FileSearch className="icon-md" />,
        });
      }

      if (capabilities.codeEnabled && codeAllowedByAgent) {
        items.push({
          label: localize('com_ui_upload_code_files'),
          onClick: () => {
            setToolResource(EToolResources.execute_code);
            setEphemeralAgent((prev) => ({
              ...prev,
              [EToolResources.execute_code]: true,
            }));
            onAction();
          },
          icon: <TerminalSquareIcon className="icon-md" />,
        });
      }

      // Recent files submenu
      if (recentFiles.length > 0) {
        const recentFilesItems: MenuItemProps[] = recentFiles.map((file) => ({
          label: file.filename,
          onClick: () => handleAttachExistingFile(file),
          icon: file.type.startsWith('image') ? (
            <ImageUpIcon className="icon-sm" />
          ) : (
            <FileUp className="icon-sm" />
          ),
        }));

        items.push({
          label: localize('com_ui_recent_files'),
          onClick: () => {},
          icon: <Clock className="icon-md" />,
          subItems: recentFilesItems,
        });
      }

      return items;
    };

    const localItems = createMenuItems(handleUploadClick);

    if (sharePointEnabled) {
      localItems.push({
        label: localize('com_files_upload_sharepoint'),
        onClick: () => {
          setToolResource(EToolResources.context);
          setIsSharePointDialogOpen(true);
        },
        icon: <SharePointIcon className="icon-md" />,
      });
      return localItems;
    }

    return localItems;
  }, [
    localize,
    endpoint,
    provider,
    endpointType,
    capabilities,
    useResponsesApi,
    setToolResource,
    setEphemeralAgent,
    sharePointEnabled,
    codeAllowedByAgent,
    fileSearchAllowedByAgent,
    providerUploadAllowedByAgent,
    setIsSharePointDialogOpen,
    handleSmartUpload,
    allFiles,
    fileMap,
    showToast,
    addFile,
    setIsPopoverActive,
  ]);

  const menuTrigger = (
    <TooltipAnchor
      render={
        <Ariakit.MenuButton
          disabled={isUploadDisabled}
          id="attach-file-menu-button"
          aria-label="Attach File Options"
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            isPopoverActive && 'bg-surface-hover',
          )}
        >
          <div className="flex w-full items-center justify-center gap-2">
            <AttachmentIcon />
          </div>
        </Ariakit.MenuButton>
      }
      id="attach-file-menu-button"
      description={localize('com_sidepanel_attach_files')}
      disabled={isUploadDisabled}
    />
  );
  const handleSharePointFilesSelected = (sharePointFiles: any[]) => {
    setIsSharePointDialogOpen(false);
    setPendingSharePointFiles(sharePointFiles);
    setShowSharePointUploadModal(true);
  };

  const handleSharePointUploadOptionSelect = useCallback(
    async (selectedToolResource: EToolResources | undefined) => {
      setShowSharePointUploadModal(false);
      const filesToProcess = pendingSharePointFiles;
      setPendingSharePointFiles([]);
      try {
        await handleSharePointFiles(filesToProcess, selectedToolResource);
      } catch (error) {
        console.error('SharePoint file processing error:', error);
      }
    },
    [handleSharePointFiles, pendingSharePointFiles],
  );

  return (
    <>
      <FileUpload
        ref={inputRef}
        handleFileChange={(e) => {
          handleFileChange(e, toolResource);
        }}
      >
        <DropdownPopup
          menuId="attach-file-menu"
          className="overflow-visible"
          isOpen={isPopoverActive}
          setIsOpen={setIsPopoverActive}
          modal={true}
          unmountOnHide={true}
          trigger={menuTrigger}
          items={dropdownItems}
          iconClassName="mr-0"
        />
      </FileUpload>
      <SharePointPickerDialog
        isOpen={isSharePointDialogOpen}
        onOpenChange={setIsSharePointDialogOpen}
        onFilesSelected={handleSharePointFilesSelected}
        isDownloading={isProcessing}
        downloadProgress={downloadProgress}
        maxSelectionCount={endpointFileConfig?.fileLimit}
      />
      <OGDialog
        open={showSharePointUploadModal}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSharePointFiles([]);
          }
          setShowSharePointUploadModal(open);
        }}
      >
        <OGDialogTemplate
          title={localize('com_ui_upload_type')}
          className="w-11/12 sm:w-[440px] md:w-[400px] lg:w-[360px]"
          main={
            <div className="flex flex-col gap-2">
              {sharePointUploadOptions.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleSharePointUploadOptionSelect(option.value)}
                  className="flex items-center gap-2 rounded-lg p-2 hover:bg-surface-active-alt"
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          }
        />
      </OGDialog>
    </>
  );
};

export default React.memo(AttachFileMenu);
